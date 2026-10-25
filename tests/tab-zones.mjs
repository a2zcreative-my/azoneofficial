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
/* v1.183.0 - commission.tsx retired with the Commission tab */
const trading = read("components/portal/trading-desk.tsx");
const dash = read("components/portal/dashboard.tsx");
const panels = read("components/portal/role-panels.tsx");
const sales = read("components/portal/sales.tsx");
const elfia = read("components/portal/elfia-store-panel.tsx");
let failed = 0, passed = 0;
const ok = (label, cond, why = "") => { if (cond) passed++; else { failed++; console.log(`  ✗ ${label}${why ? ` — ${why}` : ""}`); } };

/* v1.185.0 - THE ECOMMERCE PAGE IS ITS OWN PANEL (components/portal/
   ecommerce-panel.tsx, the owner's reference of 22-10-2026): a tab row
   (Overview · Orders · Products → Inventory · Fulfilment · Analytics ·
   Setup) and an Overview that reads tiles, the orders table beside
   fulfilment and the top states, the map, then the month's detail. The
   page hands the whole tab to the panel; the rules below moved with it. */
const tab = read("components/portal/ecommerce-panel.tsx");
ok("the Ecommerce block hands the tab to its panel", /\{activeTab === "Ecommerce" && \([\s\S]{0,400}?<EcommercePanel user=\{user\} lang=\{lang\} go=\{setTab\} canOpen=\{canOpen\} \/>/.test(page));

/* 1. the order of the Overview */
const overview = tab.slice(tab.indexOf('{view === "overview" && ('), tab.indexOf('{view === "orders" &&'));
const seq = ["{tiles}", "<TikTokOrdersTable", "<FulfilmentCard", "<TopStatesCard", "<OpsMapCard", "<RevenueAndHoursCard"];
const pos = seq.map((s) => overview.indexOf(s));
ok("every card is on the Overview", pos.every((x) => x > 0), seq.filter((s, i) => pos[i] < 0).join(","));
ok("tiles, orders, fulfilment, top states, map, the month's detail - in that order", pos.every((x, i) => i === 0 || x > pos[i - 1]), pos.join(" < "));
ok("the map's side column is empty: no commission leaderboard rides there", /<OpsMapCard \/>/.test(tab) && !/LeaderboardCard/.test(tab));
/* v1.191.0 - the owner's photo has no captions over the work row or the
   map; the month's detail below them keeps its own */
const caps = ["This month"];
ok("the Overview's month detail is captioned", caps.every((c) => overview.includes(`<ZoneLabel>{L("${c}"`)), caps.filter((c) => !overview.includes(`<ZoneLabel>{L("${c}"`)).join(","));
ok("revenue stays one shared tabbed card", tab.split("<RevenueAndHoursCard").length === 2);
/* the 2fr / 1fr split is the panel's own module, applied when the role sees revenue */
const ecomCss = read("components/portal/ecommerce-panel.module.css");
ok("the orders table is wide and fulfilment beside it",
   /className=\{`\$\{css\.work\} \$\{canRevenue \? css\.workSplit : ""\}`\}/.test(tab)
   && /\.workSplit \{\s*grid-template-columns: minmax\(0, 2fr\) minmax\(0, 1fr\);/.test(ecomCss));
/* v1.191.0 - the owner's photo: underline tabs (LineTabs), the month and
   "Sync from TikTok" at the right; Products still opens Inventory */
ok("the tab row is the shared underline tabs, and Products opens Inventory rather than pretending to be a page",
   /<LineTabs value=\{view\}/.test(tab) && /k === \("products" as View\) \? go\("Inventory"\) : setView\(k\)/.test(tab)
   && /canOpen\("Inventory"\) \? \(\[\["products"/.test(tab)
   && /\{canSync && \(\s*<TabAction icon="refresh"/.test(tab) && /window\.dispatchEvent\(new Event\("azone:tiktok-sync"\)\)/.test(tab)
   && /window\.addEventListener\("azone:tiktok-sync", run\)/.test(read("components/portal/tiktok-orders.tsx")));

/* 2. visual and keyboard reading order agree on every viewport */
ok("Ecommerce uses DOM order, not viewport-dependent CSS reordering", !/\border-[12]\b/.test(tab) && !/order:\s*-?\d/.test(ecomCss));
ok("...and the cards appear once each on the Overview", seq.every((s) => overview.split(s).length === 2));

/* 3. one caption component */
ok("ZoneLabel lives in page-shared and both tabs use it", /export function ZoneLabel\(/.test(shared) && /ZoneLabel/.test(dash) && !/^function ZoneLabel\(/m.test(dash) && tab.includes("<ZoneLabel>"));

/* 4. gates - the same gates the page had */
ok("analytics stays CEO-only", /const canAnalytics = \["ceo", "super_admin"\]\.includes\(user\.role\);/.test(tab) && /\{view === "analytics" && canAnalytics && <TikTokAnalyticsCard \/>\}/.test(tab) && /\.\.\.\(canAnalytics \? \(\[\["analytics"/.test(tab));
ok("the orders table is not behind the revenue gate", !/canRevenue && \(?\s*<TikTokOrdersTable/.test(tab) && (tab.match(/<TikTokOrdersTable role=\{user\.role\} \/>/g) ?? []).length === 2);
ok("the tiles, fulfilment, the top states, the map and the month's detail stay behind it",
   /const tiles = canRevenue && \(/.test(tab)
   && /\{canRevenue && \(\s*<div className=\{css\.aside\}>\s*<FulfilmentCard onViewAll=\{\(\) => setView\("fulfilment"\)\} \/>\s*<TopStatesCard/.test(tab)
   && /\{canRevenue && \(\s*<div ref=\{mapRef\} className=\{css\.mapAnchor\}>\s*<OpsMapCard \/>/.test(tab)
   && /\{canRevenue && \(\s*<section className="erp-stack-tight">[\s\S]{0,300}?<RevenueAndHoursCard/.test(tab)
   && /\{view === "fulfilment" && canRevenue && \(/.test(tab)
   && /useCachedApi<RevenueData>\(canRevenue \? "\/staff\/revenue" : null\)/.test(tab));
ok("a tile is a figure the server states, never a guess: revenue and orders from /staff/revenue, delivered and to-ship from the fulfilment summary",
   /value=\{r \? fmtRM\(r\.tiktok\.this_cents\) : 0\}/.test(tab) && /value=\{r \? r\.tiktok\.this_orders : 0\}/.test(tab)
   && /const delivered = n\("delivered"\);/.test(tab) && /const toShip = n\("preparing"\);/.test(tab) && !/pending.?sync/i.test(tab.replace(/\/\*[\s\S]*?\*\//g, "")));

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
  /* v1.193.0 - both draw one PAGE of that list (pageItems = visibleItems sliced) */
  ok("the table and the phone list draw from ONE filtered list", inv.split("{pageItems.map((it) => (").length === 3 && /const pageItems = invPer > 0 \? visibleItems\.slice\(/.test(inv) && !/\{sortedItems\.map\(\(it\) => \(/.test(inv),
     "two lists from two sources can disagree about what is in stock");
  ok("the phone list is phone-only and the table desk-only", /<ul className="[^"]*md:hidden">\s*\{pageItems\.map/.test(inv) && /<div className=\{`mt-3 hidden overflow-x-auto overflow-y-auto pr-1 md:block \$\{ivc\.stockScroll\}`\}>/.test(inv));
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
  /* v1.191.0 - the work card has no caption (the owner's photo); its Documents head opens it */
  const inner = [comp.indexOf('Documents (All)'), comp.indexOf("{editingDoc ? ("), comp.indexOf("cloneElement(workExtra"), comp.indexOf('L("Customers", "Pelanggan")'), comp.indexOf("{editingCust ? ("), comp.indexOf("{customersExtra}")];
  ok("THE WORK precedes CUSTOMERS without duplicating their forms", inner.every((x) => x > 0) && inner.every((x, i) => i === 0 || x > inner[i - 1]), inner.join(" < "));
  ok("Sales opens records by default and keeps explicit creation intent", comp.includes('initialView = "documents"') && comp.includes('(initialView)') && page.includes('setSalesStart("create")') && dash.includes('onCreateQuotation()'));
  ok("editing a document opens its mounted form and scrolls the workspace", /setEditingDoc\(\{\s*id: d\.id, doc_number: d\.doc_number,[\s\S]{0,200}?\}\);\s*setWorkTab\("create"\)/.test(comp) && comp.includes('getElementById("sales-work")?.scrollIntoView'));
  /* v1.191.0 - the work's three bodies are reached from the Documents pill
     row (documents and the money views) and the top bar (Create document) */
  ok("Customers has two tabs, and the work's three bodies each have a way in", /value=\{custTab\} onChange=\{setCustTab\}/.test(comp) && ["add", "clients"].every((k) => comp.includes(`["${k}", L(`))
     && /setWorkTab\("create"\)/.test(comp) && /setWorkTab\("documents"\); setDocType\(v\)/.test(comp) && /setWorkTab\("receipts"\); setMoney\(v\)/.test(comp)
     && ["receipts", "credit", "outstanding"].every((k) => comp.includes(`["${k}", L(`)));
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
  /* v1.193.0 - the page is six tabs; What moved's two panes are chosen by
     them (TikTok under Reports & Analytics, manual under Stock In & Out) */
  void mvTabs;
  ok("What moved is one card whose panes the page's tabs choose", /<div hidden=\{view !== "reports"\}>\s*<p className=\{ivc\.paneTitle\}>\{L\("TikTok Live — stock out"/.test(inv) && /<div hidden=\{view !== "inout"\}>\s*<p className=\{ivc\.paneTitle\}>\{L\("Manual stock movements"/.test(inv));
  ok("each tab body is hidden, never unmounted - a half-typed return survives a look at postage",
     recTabs.every((k) => inv.includes(`recordTab === "${k}" ? "mt-3" : "hidden"`)) && (inv.match(/className="erp-stack-tight erp-tab-zone[^"]*" hidden=\{view !== "/g) ?? []).length >= 6,
     "unmounting would refetch and lose what was typed");
  ok("Inventory: six tabs in the brief's order", ["Overview", "Stock Inventory", "Stock In & Out", "Supplier Returns", "Stock Take", "Reports & Analytics"].map((t) => inv.indexOf(`L("${t}"`)).every((x, i, a) => x > 0 && (i === 0 || x > a[i - 1])));
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
  const handRolled = [["role-panels.tsx", panels], ["sales.tsx", sales], ["elfia-store-panel.tsx", elfia], ["trading-desk.tsx", trading]]
    .filter(([, src]) => /rounded-full px-3 py-1 text-xs font-medium"/.test(src) || /!bg-primary !text-primary-foreground/.test(src));
  ok("no card hand-rolls the tab pill any more", handRolled.length === 0, handRolled.map(([f]) => f).join(", "));
  for (const [file, src] of [["role-panels.tsx", panels], ["sales.tsx", sales], ["trading-desk.tsx", trading]]) {
    if (src.includes("<SectionTabs")) ok(`${file} imports SectionTabs from page-shared`, /import \{[^}]*SectionTabs[^}]*\} from "@\/components\/portal\/page-shared"/.test(src));
  }
}

/* Approved work-first pilot: source order is shared by phone and desktop. */
{
  const ordered = (source, labels) => {
    const positions = labels.map(label => source.indexOf(label));
    return positions.every((p, i) => p >= 0 && (i === 0 || p > positions[i - 1]));
  };
  /* v1.171.0 - five cards, same order: hero, desk (+ watchers), my month,
     the company, around me. NextEventCard left the Dashboard. */
  /* v1.176.0 - the Dashboard shows a SUMMARY of the queue, not the queue: the
     full lists and the watchers moved to the Desk page. The zones themselves
     are ordered per job by DASHBOARD_ZONES (tests/one-desk.mjs asserts the
     map), so what this guard holds is that the summary card is still there,
     still above the month and the company, and still not a second copy. */
  ok("the Dashboard's queue is a summary card, above the metrics and the company",
    ordered(dash, ['<PanelTitle icon="time"', '<DeskSummary', 'L("My month"', '<TradingDesk', 'L("Around me"'])
    && !/<WatchersCard/.test(dash) && !/<DeskQueue/.test(dash));
  /* v1.188.0 - the Attendance tab is its own tabbed panel (the owner's brief):
     Overview (tiles, the monitor, the donut, quick actions, today's
     assignments) · My Attendance · Team Attendance (the report, the
     verification card) · Schedule & Roster · Management (OT approvals, the
     corrections panel). The page hands the tab to the panel. */
  const attendance = read("components/portal/attendance-panel.tsx");
  ok("the Attendance block hands the tab to its panel", /\{activeTab === "Attendance" && \([\s\S]{0,400}?<AttendancePanel user=\{user\} go=\{setTab\} \/>/.test(page));
  /* v1.191.0 - the owner's photo's seven tabs: Overview, Attendance, On
     Shift (opens the On Shift page), Roster, Team, Reports, Settings */
  ok("Attendance: overview, my records, the roster, the team's, the report, then the settings - in that order",
    ordered(attendance, ['<AttendanceOverview', '<Attendance user={user} view="mine"', '<TodayAssignmentsCard', '<RosterBoard', '<OtApprovalsCard', '<Attendance user={user} view="team"', '<VerificationCard', '<AttendanceAdminPanel']));
  ok("the seven tabs are the shared underline tabs, On Shift opens its page, and every body stays mounted (hidden, never unmounted)",
    /<LineTabs value=\{view\} onChange=\{pick\} tabs=\{tabs\}/.test(attendance)
    && /const pick = \(k: View\) => \(k === "onshift" \? go\("On Shift"\) : setView\(k\)\);/.test(attendance)
    && ['"overview"', '"mine"', '"roster"', '"team"', '"reports"', '"settings"'].every((v) => attendance.includes(`hidden={view !== ${v}}`)));
  ok("the assignments card's Open roster opens the roster tab and scrolls to the board",
    /<div id="roster-board" className=\{css\.rosterAnchor\} ref=\{rosterRef\}>\s*<RosterBoard/.test(attendance)
    && /\.rosterAnchor \{\s*scroll-margin-top: 4rem;/.test(read("components/portal/attendance-panel.module.css"))
    && /onOpenRoster=\{\(\) => \{ setView\("roster"\); revealAnchor\("roster-board"\); \}\}/.test(attendance)
    && /window\.dispatchEvent\(new CustomEvent\("azone:reveal", \{ detail: id \}\)\)/.test(read("components/portal/page-shared.tsx"))
    && /"ot-approvals": "team", "pending-punches": "settings", "roster-board": "roster"/.test(attendance));
  /* v1.189.0 - the Users page is its own tabbed panel (users-panel.tsx):
     Overview, Staff Accounts, Customer Accounts, Roles & Permissions,
     Security & Settings; every body stays mounted and hidden. */
  const users = page.slice(page.indexOf('{activeTab === "Users"'), page.indexOf('{activeTab === "Profile"'));
  const usersPanel = read("components/portal/users-panel.tsx");
  ok("the Users block hands the tab to its panel", /\{activeTab === "Users" && <UsersPanel role=\{user\.role\} go=\{setTab\} \/>\}/.test(users));
  ok("Users: overview, staff, customers, the matrix, then the log and the access cards - in that order",
    ordered(usersPanel, ['<UsersOverview', 'L("Staff accounts", "Akaun kakitangan")}>', 'L("Customer accounts", "Akaun pelanggan")}>', '<TabAccessCard', 'L("Sign-in log"', '<AccessReviewCard', '<GeofenceCard']));
  /* the owner's reference draws these five as underline tabs (a gold rule
     under the open one) - this page's own, everything else keeps the pill */
  ok("the five Users tabs are the reference's underline tabs, and every body stays mounted (hidden, never unmounted)",
    /<LineTabs value=\{view\} onChange=\{setView\} tabs=\{tabs\}/.test(usersPanel)
    && ['"overview"', '"staff"', '"customers"', '"roles"', '"security"'].every((v) => usersPanel.includes(`hidden={view !== ${v}}`)));
  ok("each Users card keeps the gate the page gave it",
    /const holds = \["ceo", "super_admin"\]\.includes\(role\)/.test(usersPanel)
    && /const geofence = \["super_admin", "ceo", "coo"\]\.includes\(role\)/.test(usersPanel)
    && /const canEdit = role === "super_admin"/.test(usersPanel)
    && /\{holds && <AccessReviewCard \/>\}/.test(usersPanel) && /\{geofence && <GeofenceCard \/>\}/.test(usersPanel)
    && /<TabAccessCard canEdit=\{holds\}/.test(usersPanel));
}

/* The approved rollout retains already-correct tabs and reorders exceptions. */
{
  const ordered = (source, labels) => {
    const positions = labels.map(label => source.indexOf(label));
    return positions.every((p, i) => p >= 0 && (i === 0 || p > positions[i - 1]));
  };
  /* v1.172.0 - Reconciliation, Ads Fund and Purchasing are retired; their
     order checks went with them. Accounting moved to its own file.
     v1.183.0 - Commission and Sales Performance retired; likewise. */
  const accounting = read("components/portal/accounting-panel.tsx");
  const assets = read("components/portal/assets-panel.tsx");
  const hotels = read("components/portal/hotels-panel.tsx");
  const payroll = read("components/portal/payroll-panel.tsx");
  const leave = read("components/portal/leave.tsx");
  const tasks = read("components/portal/tasks.tsx");
  const announcements = read("components/portal/announcements.tsx");
  ok("Accounting: balance before adjustment", ordered(accounting, ['L("Trial balance"', 'L("New journal entry"']));
  ok("Assets: status, register, editor", ordered(assets, ['L("Company assets"', 'L("Register"', 'id="asset-form"']));
  ok("Asset edit scrolls to its relocated form", assets.includes('getElementById("asset-form")?.scrollIntoView'));
  /* v1.199.0 - five tabs in the brief's order, every zone kept mounted and hidden with av.off */
  ok("Assets: five tabs in the brief's order, zones hidden not unmounted", ["Overview", "Asset Register", "Assignments", "Maintenance & Disposal", "Reports & Audit"].map((t) => assets.indexOf(`L("${t}"`)).every((x, i, a) => x > 0 && (i === 0 || x > a[i - 1])) && (assets.match(/className=\{view !== "[a-z]+" \? av\.off : ""\}/g) ?? []).length === 5);
  /* v1.173.0 (tab concept): the map is THE MAP zone (TabZone label "The map");
     the search, the state filter and the pipeline precede it as before. */
  /* v1.202.0 - five tabs in the brief's order, every zone kept mounted and
     hidden with hp.off; within the page the filters still come before the
     contact work and the map, and the call log lives in the hotel's drawer */
  const hotelsFn = hotels.slice(hotels.indexOf('export function HotelsPanel'));
  ok("Hotels: five tabs in the brief's order, zones hidden not unmounted", ["Overview", "Hotel Directory", "Outreach & Partnerships", "Reviews & Stays", "Map & Analytics"].map((t) => hotelsFn.indexOf(`L("${t}"`)).every((x, i, a) => x > 0 && (i === 0 || x > a[i - 1])) && (hotelsFn.match(/className=\{tab !== "[a-z]+" \? hp\.off : ""\}/g) ?? []).length === 5);
  ok("Hotels: filters and contact work before the map, the call log in the hotel's drawer", ordered(hotelsFn, ['L("Search the directory"', 'L("Filter by state"', 'L("Show hotels that are"', 'label={L("The map", "Peta")}', '================= THE MAP', '<HotelPipeline key={openHotel.id}']));
  ok("Hotels: Add hotel only for the roles that may edit, the toast and the question outside every zone", /aside=\{canManage \? \(\s*<TabAside>\s*<TabAction icon="add" onClick=\{startAdd\}>/.test(hotelsFn) && hotelsFn.indexOf("{confirmNode}") < hotelsFn.indexOf("<TabZone"));
  ok("Hotels: no contracts, staffing or allowance on the page (the directory has no such data)", !/allowance|contract(?:ed)?\b|staff assigned/i.test(hotelsFn.replace(/\/\*[\s\S]*?\*\//g, "")));
  /* v1.192.0 - the HR page is six tabs (hr-page.tsx): the brief's order, the
     administration gate the page used (now HR_ADMIN_ROLES inside it), the
     task report, the holidays and payslip cards behind that gate, the
     lifecycle, and the birthdays */
  const hr = read("components/portal/hr-page.tsx");
  ok("HR: six tabs in the brief's order", ordered(hr, ['L("Overview"', 'L("Reports"', 'L("Calendar & Holidays"', 'L("Employee Lifecycle"', 'L("Payroll & Payslips"', 'L("HR Administration"']));
  ok("HR: the administration gate is the four roles it was", hr.includes('export const HR_ADMIN_ROLES = ["hr_admin", "ceo", "super_admin", "admin"];') && /\{admin \? <HolidaysCard \/> : <PermissionPlaceholder/.test(hr) && /\{admin && has\("payroll"\)/.test(hr) && /\{admin && has\("lifecycle"\)/.test(hr));
  ok("HR: task report, birthdays and lifecycle are all still on the page", hr.includes('L("Task report"') && hr.includes('L("Staff birthdays"') && hr.includes("<PeoplePanel ") && page.includes('<HrPage user={user} go={setTab} canOpen={canOpen} />'));
  ok("Finance: cash then expenses with reporting after payments due", page.includes('<ExpensesPanel reporting={<PnlCard />} />') && ordered(panels.slice(panels.indexOf('export function ExpensesPanel')), ['L("Payments due', '{reporting}', 'payments COMPLETED']));
  const pay = payroll.slice(payroll.indexOf('export function PayrollPanel'));
  /* v1.198.0 - five tabs in the brief's order: the register and Save all
     (Processing), the release (Payslips), the bank file (Reports & Export),
     then the base salaries and the M2E setup (Settings & Audit); every zone
     kept mounted and hidden with pp.off */
  ok("Payroll: review before save, release, payment export and setup", ordered(pay, ['<table className="tbl-sticky', 'L("Save all"', 'L("Release now"', 'L("M2E salary file"', 'id="payroll-base"', 'L("M2E setup (one-time)']));
  ok("Payroll: five tabs in the brief's order, zones hidden not unmounted", ["Overview", "Payroll Processing", "Payslips", "Reports & Export", "Settings & Audit"].map((t) => pay.indexOf(`L("${t}"`)).every((x, i, a) => x > 0 && (i === 0 || x > a[i - 1])) && (pay.match(/className=\{view !== "[a-z]+" \? pp\.off : ""\}/g) ?? []).length === 5);
  ok("Claims: submission link, pending decisions, form, records", ordered(panels.slice(panels.indexOf('export function ClaimsPanel')), ['openClaims("submit")', 'id="claims-pending"', 'id="claim-form"', 'L("All claims"']));
  /* v1.194.0 - five tabs, in the brief's order; every zone hidden, never unmounted */
  const claimsP = panels.slice(panels.indexOf('export function ClaimsPanel'));
  ok("Claims: five tabs in the brief's order", ["Overview", "Submit Claim", "My Claims", "Approvals", "Reports & Payments"].map((t) => claimsP.indexOf(`L("${t}"`)).every((x, i, a) => x > 0 && (i === 0 || x > a[i - 1])));
  ok("Claims: each zone stays mounted under the other tabs", (claimsP.match(/className=\{view !== [a-zA-Z"]+ \? cov\.off : ""\}/g) ?? []).length >= 5 && /hidden=\{view !== "overview"\}/.test(claimsP));
  /* v1.196.0 - the history is searched (mine.filter(matchQ)); five tabs, each zone kept mounted */
  ok("Leave: five tabs in the brief's order, zones hidden not unmounted", ["Overview", "Apply Leave", "My Leave", "Team Calendar", "Approvals & Management"].map((t) => leave.indexOf(`L("${t}"`)).every((x, i, a) => x > 0 && (i === 0 || x > a[i - 1])) && (leave.match(/className=\{view !== "[a-z]+"[^}]*\? lv\.off : ""\}/g) ?? []).length >= 6);
  ok("Leave: application, pending company decisions, personal history", ordered(leave.slice(leave.indexOf('export function Leave({')), ['L("Apply for leave"', 'pending.map((l)', 'mine.filter(matchQ).map((l)']));
  /* v1.200.0 - five tabs: my work and all work (the active rows by default) before
     creation, then the company-wide progress and the completion archive */
  ok("Tasks: active records before creation, progress, completion archive", ordered(tasks, ['renderTasks(sift(myTasks, { status: true })', 'renderTasks(sift(tasks, { status: true, who: true })', 'L("Create / assign a task"', '{progress}', 'renderTasks(tasks.filter((t) => t.status === "completed")']) && /useState<StatusF>\("active"\)/.test(tasks));
  ok("Tasks: five tabs in the brief's order (All Tasks only for the managing roles), zones hidden not unmounted", ["Overview", "My Tasks", "All Tasks", "Create / Assign Task", "Reports & Archive"].map((t) => tasks.indexOf(`L("${t}"`)).every((x, i, a) => x > 0 && (i === 0 || x > a[i - 1])) && /\.\.\.\(canManage \? \[\["all"/.test(tasks) && (tasks.match(/className=\{view !== "[a-z]+" \? tk\.off : ""\}/g) ?? []).length === 5);
  /* v1.201.0 - Staff: five tabs in the brief's order, every zone kept mounted
     and hidden with sp.off; Add staff on the tab row for everyone who could
     add before (not the read-only COO and CCO); the toast and the question
     outside every zone; the same record, gates and badge printing */
  const staffDir = read("components/staff/staff-directory.tsx");
  const staffFn = staffDir.slice(staffDir.indexOf("export function StaffDirectory("), staffDir.indexOf("/* v1.4.191 STAFF DOCUMENT VAULT"));
  /* v1.204.0 - six: the Team Map is its own tab beside the Organisation chart */
  ok("Staff: six tabs in the brief's order, zones hidden not unmounted", [["overview", "Overview"], ["directory", "Directory"], ["org", "Organisation"], ["team", "Team Map"], ["roles", "Departments & Roles"], ["records", "Staff Records"]].map(([k, t]) => staffFn.indexOf(`["${k}", L("${t}"`)).every((x, i, a) => x > 0 && (i === 0 || x > a[i - 1])) && (staffFn.match(/className=\{tab !== "[a-z]+" \? sp\.off : ""\}/g) ?? []).length === 6);
  ok("Staff: Add staff on the tab row, never for the read-only roles", /aside=\{!readOnly \? \(\s*<TabAside>\s*<TabAction icon="add" onClick=\{\(\) => setShowCreate\(true\)\}>/.test(staffFn) && /open=\{!readOnly && showCreate\}/.test(staffFn));
  ok("Staff: the toast and the question render outside every zone", staffFn.indexOf("{toastNode}{promptNode}") > 0 && staffFn.indexOf("{toastNode}{promptNode}") < staffFn.indexOf("<TabZone"));
  ok("Staff: the record keeps its gates (Save and photo for the writers, Offboard for the amenders, role for the CEO and COO)", /open\.has\(u\.id\) && !readOnly && \(/.test(staffFn) && /open\.has\(u\.id\) && canAmend && !\["resigned", "terminated"\]/.test(staffFn) && /sec\.title === "Employment" && canSetRole && \(/.test(staffFn) && /const isLocked = \(u: Staff, key: keyof Staff\) =>\s*readOnly \|\| \(!canAmend && /.test(staffFn));
  ok("Staff: badges print one or many, from the record, the drawer and the selection", /onClick=\{\(\) => printBadge\(merged\)\}/.test(staffFn) && /printBadge\(\{ \.\.\.u, \.\.\.draft\[u\.id\] \} as Staff\)/.test(staffFn.slice(staffFn.indexOf("const profileFooter"))) && /printBadges\(staff\.filter\(\(u\) => selected\.has\(u\.id\)\)/.test(staffFn));
  /* v1.201.1 - a leaver's status says the sign-in is blocked, which is true only
     while the worker's login still refuses resigned and terminated */
  ok("Staff: a leaver reads \"Sign-in blocked\", and the login still refuses leavers", /if \(s === "left"\) \{[\s\S]{0,1200}?L\("Sign-in blocked", "Log masuk disekat"\)/.test(staffFn) && /AND COALESCE\(employment_status, ''\) NOT IN \('resigned', 'terminated'\)/.test(read("worker/src/index.ts")));
  /* v1.204.0 - the body moved to profileBody (the drawer and the docked panel
     draw the same one); it is held to the same rule, and it shows no pay
     figure: Payroll owns salaries and payslips */
  ok("Staff: the profile (drawer and docked panel) carries no IC, bank or statutory number, and no pay figure", (() => {
    const body = staffFn.slice(staffFn.indexOf("THE PROFILE, one body"), staffFn.indexOf("return (", staffFn.indexOf("const profileFooter")));
    const d = staffFn.slice(staffFn.indexOf("THE PROFILE DRAWER"), staffFn.indexOf("Add staff opens here"));
    const banned = /ic_number|bank_name|bank_account|epf_no|socso_no|tax_no|address|emergency_|salary|base_pay|net_pay|gross|\/payroll|\/payslip/;
    return body.length > 3000 && d.length > 200 && !banned.test(body) && !banned.test(d) && /\{peekU && profileBody\(peekU\)\}/.test(d) && /\{profileBody\(peekU\)\}/.test(staffFn);
  })());
  ok("Staff: Leave, Attendance, Payroll and Users are links to their own records, drawn only where the tab strip shows them", /const linkTo = \(t: TabName, label: string\) => \(can\(t\) && go/.test(staffFn) && ["Leave", "Attendance", "Payroll"].every((t) => staffFn.includes(`linkTo("${t}"`)) && /can\("Users"\) && go &&/.test(staffFn) && /go=\{setTab\}\s*canOpen=\{canOpen\}/.test(page));
  ok("Staff: the profile only reads (no write from Leave, Attendance or Payroll)", (() => { const body = staffFn.slice(staffFn.indexOf("THE PROFILE, one body"), staffFn.indexOf("return (", staffFn.indexOf("const profileFooter"))); return !/method:\s*"(?:POST|PUT|PATCH|DELETE)"|csrfFetch/.test(body) && /"\/staff\/leave\?all=1"/.test(body) && /"\/staff\/attendance\/monitor"/.test(body); })());
  ok("Announcements: unacknowledged, publishing, acknowledged archive", ordered(announcements, ['{renderAnnouncements(anns.filter((a) => !a.acked)', 'L("Publish news"', '{renderAnnouncements(anns.filter((a) => a.acked)']));
  ok("Profile already keeps personal details ahead of pay and security", ordered(page.slice(page.indexOf('{activeTab === "Profile"')), ['<Profile />', '<MyPayslip />', '<TwoFactorPanel />', 'href="/privacy"']));
}

if (failed) { console.log(`\n${failed} check(s) failed.`); process.exit(1); }
console.log(`PASS — every tab reads in zones, one card shows one thing at a time through one shared tab component, and the document form is still the paper (${passed} checks)`);

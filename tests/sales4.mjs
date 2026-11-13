/* v1.292.0 - A2Z OS SALES WORKSPACE 4.0 (the CEO's "approve", 12-11-2026;
   claude/SALES-WORKSPACE-4.0-BLUEPRINT.md, decisions S1-S7).

   What this holds, in the source (the browser half is tests/browser/sales4.py):
     - the six written views, in the written order; the view in the address
       (tab and view only, never a record) so Back and Forward move between them;
     - tabs on a wide screen, one selector on a phone; one gold action per view
       and none on Closed Sales and Reports;
     - the Overview is one strip and one worklist - nothing else;
     - the strip says "Verified outstanding" and "Pending payment verification"
       only while the CEO verifies payments; the pending figure is the
       Payments queue's own;
     - a reported payment is reviewed by the owner account only; everyone else
       sees View; an invoice's report action is the payment engine's own;
     - the new pieces only draw: no request is written from them, no figure is
       invented, no checkbox, no drag, no stored stage, no Proposal column;
     - Reports mounts one report at a time; Packages lives in Documents;
     - Closed Sales keeps four separate facts: settlement, closer, commission
       eligibility, payout (the payout is the Commission ledger's own word).
   Each rule is also proven to catch its own breakage (the mutation pass).

     node tests/sales4.mjs        (NOMUT=1 skips the mutation pass) */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

const FILES = {
  shell: "components/portal/sales-shell.tsx",
  views: "components/portal/sales-views.tsx",
  sales: "components/portal/sales.tsx",
  ws: "components/portal/sales-workspace.tsx",
  provider: "components/portal/portal-provider.tsx",
  page: "app/portal/page.tsx",
};

const between = (s, a, b) => { const i = s.indexOf(a); if (i < 0) return ""; const j = s.indexOf(b, i + a.length); return s.slice(i, j < 0 ? s.length : j); };

function checks(src) {
  const res = [];
  const ok = (name, cond, detail = "") => res.push([name, Boolean(cond), detail]);
  const shell = strip(src.shell), views = strip(src.views), sales = strip(src.sales), ws = strip(src.ws), provider = strip(src.provider), page = strip(src.page);

  /* ---- the shell ---- */
  ok("S - the six written views, in the written order",
    /export const SALES_VIEWS = \["overview", "documents", "payments", "closed", "customers", "reports"\] as const;/.test(shell));
  const url = between(shell, "export function salesViewUrl(", "\n}\n");
  ok("S2 - the view goes in the address: the tab and the view's name only, never a record or a person",
    /u\.searchParams\.set\("tab", "Sales"\);/.test(url) && /u\.searchParams\.set\("view", view\);/.test(url) && (url.match(/searchParams\.set\(/g) ?? []).length === 2);
  const hist = between(shell, "export function useSalesViewHistory(", "\n}\n");
  ok("S2 - Back and Forward move between views (a new view is a new history entry; popstate brings it back)",
    /window\.history\.pushState\(\{ salesView: view \}, "", salesViewUrl\(view\)\)/.test(hist) && /window\.addEventListener\("popstate", onPop\)/.test(hist)
    && /if \(isSalesView\(/.test(hist) && /window\.history\.replaceState\(null, "", withoutSalesView\(\)\)/.test(hist));
  ok("S2 - a deep link's view is checked before it is used (letters and _ only, 24 at most), and the shell follows Back",
    /if \(startAt && \/\^\[a-z_\]\{1,24\}\$\/\.test\(startAt\)\) setTabStart\(/.test(provider) && /window\.addEventListener\("popstate", onPop\)/.test(provider));
  ok("S2 - a deep link is taken once per page load, so the address Sales writes is never read back as a new link and wiped",
    /const linkTaken = useRef\(false\);/.test(provider) && /if \(wanted && !linkTaken\.current && \(ALL_TABS as readonly string\[\]\)\.includes\(wanted\)\) \{\s*linkTaken\.current = true;/.test(provider));
  const bar = between(shell, "export function SalesViewBar(", "\n}\n");
  ok("tabs on a wide screen, one selector on a phone (the CEO's answer)",
    /<div className="erp-desktop-only" data-testid="sales-tabs">\s*<LineTabs value=\{view\} onChange=\{onView\}/.test(bar) && /className=\{`erp-phone-only [^`]*`\} data-testid="sales-view-bar">\s*<ViewSwitch value=\{view\} onChange=\{onView\}/.test(bar));
  const act = between(sales, "<SalesViewBar view={wsView}", "{wsView === \"overview\" && (");
  ok("one gold action per view: Report payment on Payments, Add customer on Customers, none on Closed Sales or Reports, Create document otherwise",
    /wsView === "payments" && pv\?\.on && Object\.values\(pv\.inv\)\.some\(\(v\) => v\.can_report\)/.test(act) && /wsView === "customers" \? \(/.test(act)
    && /wsView === "closed" \|\| wsView === "reports" \? null : \(/.test(act) && (act.match(/<TabAction /g) ?? []).length === 3);
  ok("the waiting count on Payments is the Payments queue's own, shown only while verification is on",
    /payments: pv\?\.on \? pv\.pend\?\.n \?\? null : null/.test(act));

  /* ---- the Overview ---- */
  const ov = between(sales, "{wsView === \"overview\" && (", "{wsView === \"closed\" && (");
  ok("the Overview is one strip and one worklist - nothing else",
    /<MetricStrip label=\{L\("Sales at a glance", "Jualan sepintas lalu"\)\} cells=\{stripCells\} \/>/.test(ov) && /<SalesWorklist rows=\{workRows\}/.test(ov)
    && (ov.match(/<[A-Z][A-Za-z]+/g) ?? []).filter((t) => !["<MetricStrip", "<SalesWorklist", "<ScopeSwitch"].includes(t)).length === 0);
  ok("S4 - the strip says Verified outstanding only while the CEO verifies payments",
    /label: pv\?\.on \? L\("Verified outstanding", "Tertunggak disahkan"\) : L\("Outstanding", "Tertunggak"\)/.test(views));
  ok("S4 - Pending payment verification is the Payments queue's own figure, and only while verification is on",
    /const pending = pv\?\.on && pv\.pend \? pv\.pend : null;/.test(views) && /label: L\("Pending payment verification", "Bayaran menunggu pengesahan"\), value: fmtRM\(pending\.cents\)/.test(views)
    && /not money yet/.test(views));
  ok("only the verified owner account reviews a reported payment; everyone else sees View",
    /const mineToVerify = payWho === "owner";/.test(views) && /label: mineToVerify \? L\("Review", "Semak"\) : L\("View", "Lihat"\)/.test(views));
  ok("an invoice's report action is the payment engine's own (actionFor), offered only where the server says can_report",
    /actionFor\(\{ total_cents: d\.total_cents, verified_cents: v\.verified_cents, pending_cents: v\.pending_cents, can_report: v\.can_report === true \}, false, payWho\)/.test(views)
    && /a && \(a\.kind === "report" \|\| a\.kind === "report_remaining"\)/.test(views));
  ok("every worklist row opens the original record", (views.match(/open: \(\) => /g) ?? []).length >= 8 && /open: toEnquiries/.test(views));

  /* ---- what the new pieces may not do ---- */
  ok("the new pieces only draw: no request is written from them",
    !/\bapi\s*[(<]/.test(shell + views) && !/method:\s*"(POST|PATCH|PUT|DELETE)"/.test(shell + views));
  ok("no invented figures or records in the new pieces (no amounts or companies typed in)",
    !/fmtRM\(\s*\d/.test(shell + views) && !/Sdn Bhd|Enterprise"|Boutique|_cents: \d/.test(shell + views));
  ok("S7 - no row checkboxes (no bulk action exists)", !/type="checkbox"/.test(shell + views));
  ok("S3 - the Board is read-only: nothing is dragged, no stage is stored, no Proposal column",
    !/draggable|onDrag|onDrop/.test(shell) && !/Proposal/.test(shell + views)
    && /const COL[^=]*= \{[^}]*enquiry:[^}]*quotation:[^}]*negotiating:[^}]*accepted:[^}]*closed:/s.test(shell));

  /* ---- Documents, Customers, Reports ---- */
  ok("a document row: one state-based action; the rest under the row's ⋯ menu", (sales.match(/<RowMenu label=/g) ?? []).length >= 1 && /data-testid="row-more"/.test(shell) && /data-testid="row-menu"/.test(shell));
  ok("S6 - Packages lives in Quotations & Invoices -> More, with the rate card editor",
    /\{ key: "packages", label: L\("Packages", "Pakej"\), on: workTab === "packages", go: \(\) => setWorkTab\("packages"\) \}/.test(sales)
    && /\{workTab === "packages" && <div className="mt-3"><PackagesPanel role=\{user\.role\} \/>\{packagesExtra\s*\}<\/div>\}/.test(sales)
    && /packagesExtra=\{<PackagesEditorCard role=\{user\.role\} \/>\}/.test(page));
  const rp = between(shell, "export function ReportPicker(", "\n}\n");
  ok("Reports: one report at a time - only the chosen one is mounted",
    /<div key=\{cur\.key\} className=\{css\.reportBody\}>\{cur\.node\}<\/div>/.test(rp) && !/reports\.map\(\(r\) => [^)]*r\.node/.test(rp) && /<ReportPicker reports=\{reportDefs\} \/>/.test(sales));
  ok("S5 - the report types: performance, the weekly target and team, ageing, collected, commission, the map, live-hour economics",
    ["performance", "team", "ageing", "collected", "commission"].every((k) => views.includes(`{ key: "${k}", label:`))
    && /\{ key: "state", label: L\("Sales by State"/.test(page) && /node: <SalesMap \/>/.test(page) && /\{ key: "live", label: L\("Live-hour Economics"/.test(page));

  /* ---- Closed Sales ---- */
  const th = between(ws, "<thead><tr>", "</tr></thead>");
  ok("Closed Sales keeps four separate facts: Settlement, Closer, Commission eligibility, Payout",
    ["Settlement", "Closer", "Commission eligibility", "Payout"].every((w) => th.includes(`{L("${w}"`)));
  ok("the payout is the Commission ledger's own word, read as far as the server shows this viewer - no amount on screen",
    /useCachedApi<\{ entries: PayoutEntry\[\] \}>\("\/staff\/commission\/entries\?scope=all"/.test(ws)
    && /interface PayoutEntry \{ invoice_id: number; kind: "earn" \| "reverse"; status: [^}]*payroll_month: string \| null \}/.test(ws) && !/interface PayoutEntry[^}]*amount_cents/.test(ws)
    && /e\.kind === "earn" && e\.status !== "void"/.test(ws));
  ok("a ledger that could not be read says Not available - never a blank that reads as no payout",
    /if \(rows === null\) return \{ label: L\("Not available", "Tiada data"\)/.test(ws));
  ok("Closed Sales: the slim strip and an Export of what the columns say",
    /label: L\("Paid in full", "Dibayar penuh"\)/.test(ws) && /label: L\("Confirmed for commission", "Disahkan untuk komisen"\)/.test(ws)
    && /data-testid="closed-export"/.test(ws) && /"Commission eligibility", "Payout"\]/.test(ws));
  return res;
}

const base = Object.fromEntries(Object.entries(FILES).map(([k, p]) => [k, read(p)]));
const res = checks(base);
let failed = res.filter(([, c]) => !c);
for (const [n, c, d] of res) if (!c) console.log(`  ✗ ${n}${d ? `  [${d}]` : ""}`);

/* the mutation pass: each breakage must be caught */
const MUT = [
  ["a view dropped", "shell", '"closed", "customers", "reports"] as const;', '"customers", "reports"] as const;'],
  ["a record put in the address", "shell", 'u.searchParams.set("view", view);', 'u.searchParams.set("view", view);\n  u.searchParams.set("doc", "1");'],
  ["views no longer history entries", "shell", 'else if (cur !== view) window.history.pushState({ salesView: view }, "", salesViewUrl(view));', 'else if (cur !== view) window.history.replaceState({ salesView: view }, "", salesViewUrl(view));'],
  ["a deep link's view used unchecked", "provider", 'if (startAt && /^[a-z_]{1,24}$/.test(startAt)) setTabStart(', 'if (startAt) setTabStart('],
  ["a deep link read again on every re-run", "provider", "if (wanted && !linkTaken.current && (ALL_TABS as readonly string[]).includes(wanted)) {", "if (wanted && (ALL_TABS as readonly string[]).includes(wanted)) {"],
  ["the phone loses its selector", "shell", "<ViewSwitch value={view} onChange={onView}", "<LineTabs value={view} onChange={onView}"],
  ["a gold action on Reports", "sales", 'wsView === "closed" || wsView === "reports" ? null : (', 'wsView === "closed" ? null : ('],
  ["a chart back on the Overview", "sales", '<MetricStrip label={L("Sales at a glance", "Jualan sepintas lalu")} cells={stripCells} />', '<MetricStrip label={L("Sales at a glance", "Jualan sepintas lalu")} cells={stripCells} /><SalesPerformanceCard />'],
  ["Verified claimed always", "views", 'label: pv?.on ? L("Verified outstanding", "Tertunggak disahkan") : L("Outstanding", "Tertunggak")', 'label: L("Verified outstanding", "Tertunggak disahkan")'],
  ["pending shown while verification is off", "views", "const pending = pv?.on && pv.pend ? pv.pend : null;", "const pending = pv?.pend ?? null;"],
  ["a COO offered Review", "views", 'const mineToVerify = payWho === "owner";', 'const mineToVerify = payWho !== "staff";'],
  ["report offered without the server's can_report", "views", "can_report: v.can_report === true }", "can_report: true }"],
  ["a write from the worklist", "views", "const workRows: WorkRow[] = [...invRows, ...qtRows, ...fuRows, ...enqRows];", 'const workRows: WorkRow[] = [...invRows, ...qtRows, ...fuRows, ...enqRows];\n    void api("/staff/sales/x", { method: "POST" });'],
  ["a made-up figure", "views", 'value: fmtRM(pending.cents)', 'value: fmtRM(125000)'],
  ["row checkboxes", "shell", 'data-testid="row-more"', 'data-testid="row-more" type="checkbox"'],
  ["a draggable board card", "shell", "<button type=\"button\" className={css.boardCard} onClick={x.open}>", "<button type=\"button\" draggable className={css.boardCard} onClick={x.open}>"],
  ["every report mounted at once", "shell", "<div key={cur.key} className={css.reportBody}>{cur.node}</div>", "{reports.map((r) => <div key={r.key}>{r.node}</div>)}"],
  ["Packages back among the reports", "sales", '{ key: "packages", label: L("Packages", "Pakej"), on: workTab === "packages", go: () => setWorkTab("packages") }', ""],
  ["the Payout column dropped", "ws", '<th>{L("Payout", "Bayaran komisen")}</th>', ""],
  ["a commission amount on Closed Sales", "ws", "recipient_role?: \"closer\" | \"agent\"; payroll_month: string | null }", "recipient_role?: \"closer\" | \"agent\"; payroll_month: string | null; amount_cents: number }"],
  ["an unread ledger shown as no payout", "ws", 'if (rows === null) return { label: L("Not available", "Tiada data")', 'if (rows === null) return null; if (!rows) return { label: L("Not available", "Tiada data")'],
];
let caught = 0;
for (const [name, file, from, to] of (process.env.NOMUT === "1" ? [] : MUT)) {
  if (!base[file].includes(from)) { console.log(`  ✗ mutation anchor missing: ${name}`); failed = [...failed, [name]]; continue; }
  const r = checks({ ...base, [file]: base[file].replace(from, to) });
  if (r.some(([, c]) => !c)) caught++;
  else { console.log(`  ✗ mutation NOT caught: ${name}`); failed = [...failed, [name]]; }
}
if (failed.length) { console.log(`\nsales4: ${failed.length} failed`); process.exit(1); }
console.log(`sales4: ${res.length} checks passed${process.env.NOMUT === "1" ? " (mutation pass skipped)" : ` (${caught} mutations caught)`}`);

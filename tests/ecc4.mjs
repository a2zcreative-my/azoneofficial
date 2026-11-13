/* v1.291.0 - A2Z OS EXECUTIVE COMMAND CENTER 4.0 (the CEO's "approve",
   12-11-2026; claude/EXECUTIVE-COMMAND-CENTER-4.0-BLUEPRINT.md).

   What this holds, in the source (the browser half is tests/browser/ecc4.py):
     - the Overview's four figures and their words: Company sales is sales,
       never Collected / Cash / Paid; "Verified outstanding" only while the
       CEO verifies payments; amount and count from one read; Pending
       decisions is the Desk's own decide list;
     - a figure that could not be read says "Not available" with Retry -
       never RM 0.00;
     - the pace word is the server's own risk level; the quoted value is
       "not revenue"; the alert band shows only while something is wrong;
     - a decision row opens its own module; nothing is approved here;
     - My Day for management is theirs alone (no company figure, no decision
       list, no attendance chart);
     - four quick actions; the phone's view switch is a real menu;
     - every card that left the Dashboard lives in its module.
   Each rule is also proven to catch its own breakage (the mutation pass).

     node tests/ecc4.mjs        (NOMUT=1 skips the mutation pass) */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const FILES = {
  ov: "components/portal/dashboard-overview.tsx",
  cards: "components/portal/executive-cards.tsx",
  dash: "components/portal/dashboard.tsx",
  att: "components/portal/attendance-panel.tsx",
  fin: "components/portal/finance-panels.tsx",
  users: "components/portal/users-panel.tsx",
  weekly: "components/portal/weekly-sales.tsx",
  sales: "components/portal/sales.tsx",
  salesViews: "components/portal/sales-views.tsx", // v1.292.0 - Sales Workspace 4.0 moved the chart into Reports
  desk: "components/portal/one-desk.tsx",
};

function checks(src) {
  const res = [];
  const ok = (name, cond, detail = "") => res.push([name, Boolean(cond), detail]);
  const ov = strip(src.ov), cards = strip(src.cards), dash = strip(src.dash);
  const a = ov.indexOf("if (exec && wk?.outlook) {");
  const execBlock = a < 0 ? "" : ov.slice(a, ov.indexOf("  return (\n    <div className={`${ov.page} ${x.page}`} data-layout={wk?.me"));
  const dayBlock = execBlock.slice(execBlock.indexOf('if (view === "day") {'), execBlock.indexOf("const alerts: AlertLine[] = [];"));
  const ovBlock = execBlock.slice(Math.max(0, execBlock.indexOf("const alerts: AlertLine[] = [];")));

  ok("management reads the 4.0 Command Center (an early return, before the staff layout)", a > 0 && execBlock.length > 2000 && dayBlock.length > 500 && ovBlock.length > 1500);
  ok("the Command Center's cards only draw: no request is written from them", !/\bapi\(/.test(cards) && !/method:\s*"(POST|PATCH|PUT|DELETE)"/.test(cards) && !/\bapi\(/.test(execBlock));

  /* the four figures */
  ok("four figures, in the photo's order: Weekly target, Company sales, Outstanding, Pending decisions",
    (ovBlock.match(/<KpiTile /g) ?? []).length === 4 && (ovBlock.match(/\{owedTile\}/g) ?? []).length === 1
    && ovBlock.indexOf('label={L("Weekly target"') < ovBlock.indexOf('label={L("Company sales"') && ovBlock.indexOf('label={L("Company sales"') < ovBlock.indexOf("{owedTile}")
    && ovBlock.indexOf("{owedTile}") < ovBlock.indexOf('label={L("Pending decisions"'));
  ok("R1 - Company sales is sales: never titled Collected, Cash or Paid, and it says what it counts",
    /label=\{L\("Company sales", "Jualan syarikat"\)\}/.test(ovBlock) && !/Collected|Cash received|basisWord/.test(execBlock)
    && /L\("This week · all channels · not cash received"/.test(ovBlock) && /L\("This week · invoices paid in full"/.test(ovBlock)
    && /L\("This week · all channels · sales, not cash received"/.test(cards));
  ok("R2 - the outstanding amount and its count come from ONE read (the week performance)",
    /fmtRM\(pw\.outstanding\.cents\)/.test(ovBlock) && /owedSub\(pw\.outstanding\.invoices\)/.test(ovBlock) && !/outstanding_invoices/.test(execBlock));
  ok("R3 - \"Verified\" only while the CEO verifies payments (the Payments queue's own switch)",
    /const verifying = pvView\.data\?\.on === true;/.test(ov) && /useCachedApi<\{ on\?: boolean \}>\(exec \? "\/staff\/payments" : null, exec/.test(ov)
    && /const owedLabel = verifying \? L\("Verified outstanding", "Tertunggak disahkan"\) : L\("Outstanding", "Tertunggak"\);/.test(execBlock)
    && /less verified payments/.test(execBlock) && /less recorded payments/.test(execBlock));
  ok("R4 - Pending decisions and Needs My Decision are the Desk's own decide list (the Desk page's request)",
    /const desk = useDeskData\(\);/.test(ov) && /const \{ decide \} = splitDesk\(deskItems\);/.test(ov)
    && /value=\{desk\.data \? decide\.length :/.test(ovBlock) && /<DecisionQueueCard items=\{decisionItems\} total=\{decide\.length\}/.test(ovBlock));
  ok("R5 - a figure that could not be read says Not available with Retry, never RM 0.00",
    /value=\{pw \? fmtRM\(pw\.outstanding\.cents\) : perfWeek\.failed \? L\("Not available"/.test(ovBlock) && /link=\{!pw && perfWeek\.failed \? \{ label: L\("Retry"/.test(ovBlock)
    && /deskFailed \? L\("Not available"/.test(ovBlock) && /link=\{deskFailed \? \{ label: L\("Retry"/.test(ovBlock) && !/fmtRM\(0\)/.test(execBlock));
  ok("R6 - the pace word is the server's risk level; nothing is worked out here",
    /if \(w\.risk === "high"\) return \{ text: L\("Below target"/.test(cards) && /if \(w\.risk === "low"\)/.test(cards) && /risk: ol\.risk\?\.level \?\? null/.test(ovBlock)
    && /days_left: ol\.days_left, required_per_day_cents: ol\.required_per_day_cents/.test(ovBlock));
  ok("R8 - the quoted value says it is not revenue; going cold is the server's own count",
    /quoted value \(not revenue\)/.test(cards) && /cold=\{ol\.ageing_quotations\}/.test(ovBlock));
  ok("R9 - the alert band shows only while something is wrong (backup over 7 days, errors in 24 h, a migration behind)",
    /\{alerts\.length > 0 && <div className=\{x\.span3\} style=\{o\(0\)\}><AlertBand alerts=\{alerts\} \/><\/div>\}/.test(ovBlock)
    && /else if \(\(backupAge \?\? 0\) > 7\)/.test(ovBlock) && /if \(errors24 > 0\)/.test(ovBlock) && /if \(mp > 0\)/.test(ovBlock) && /if \(alerts\.length === 0\) return null;/.test(cards));
  ok("a decision row opens its own module (and its anchor); nothing is decided here",
    /open: \(\) => \{ go\(d\.tab as TabName\); revealAnchor\(deskAnchor\(d\.bucket\)\); \}/.test(ovBlock) && !/approve|reject/i.test(cards.slice(cards.indexOf("export function DecisionQueueCard"), cards.indexOf("export interface WeekFigures"))));
  ok("the decisions say \"3 of 5\", overdue first then oldest, and their priority is only Overdue or Pending",
    /L\(`\$\{top\.length\} of \$\{total\}`/.test(cards) && /Number\(b\.overdue\) - Number\(a\.overdue\)/.test(cards) && !/High|Medium|Low/.test(cards.slice(cards.indexOf("export function DecisionQueueCard"), cards.indexOf("export interface WeekFigures"))));
  ok("the More drawer is not drawn for management (its cards live in their modules)", !/dash-more|moreOpen/.test(execBlock));

  /* My Day: mine only */
  ok("management's My Day has no company figure, no decision list and no attendance chart",
    !/c\.basis_cents|SalesSummaryCard|DecisionQueueCard|KpiTile|DailyAttendanceChart|TradingDesk/.test(dayBlock) && /decisions=\{desk\.data \? decide\.length : null\}/.test(dayBlock)
    && /exec \? null : DASHBOARD_ZONES\[lead\]/.test(dash));
  ok("My Contribution is only what the Sales engine credits to me", /me \? \{ basis_cents: me\.basis_cents, open_quotations: me\.open_quotations/.test(dayBlock) && !/wk\.company/.test(dayBlock));
  ok("a shift card only when one is rostered", /const rostered = shiftKind && \["idle", "open", "between", "done", "waiting", "review"\]\.includes\(shiftKind\);/.test(dayBlock) && /\{rostered && todayShift\}/.test(dayBlock));

  /* actions and the view switch */
  ok("four quick actions on every Command Center view", (execBlock.match(/<QuickActionsStrip actions=\{quick\} max=\{4\} \/>/g) ?? []).length === 2 && /const shown = max \? actions\.slice\(0, max\) : actions;/.test(cards));
  ok("the phone's view switch is a menu of two, the current one ticked, Escape closes it",
    /aria-haspopup="menu" aria-expanded=\{open\}/.test(cards) && /role="menuitemradio" aria-checked=\{k === value\}/.test(cards) && /e\.key === "Escape" && open/.test(cards)
    && /<div className=\{exec \? "erp-desktop-only" : undefined\}>/.test(dash));

  /* R10 - nothing removed with its feature: each card lives in its module */
  ok("R10 - the Daily Attendance Statistic lives in Attendance", /<DailyAttendanceChart role=\{user\.role\} \/>/.test(strip(src.att)));
  ok("R10 - Financial health lives in Finance, for the people it was drawn for", /\{week\.data\?\.outlook && <FinanceHealthCard d=\{week\.data\}/.test(strip(src.fin)));
  ok("R10 - System health lives in Users -> Security & Sessions, and the alert band opens it", /<SystemHealthCard \/>/.test(strip(src.users)) && /openAt\("Users", "security"\)/.test(ovBlock));
  ok("R10 - pace, advice, the team and the pipeline live in Sales -> Weekly target; the chart in Sales",
    /<CommandStrip o=\{d\.outlook\}/.test(strip(src.weekly)) && /<AdviceList cards=\{adv\.cards\}/.test(strip(src.weekly)) && /<Opportunities rows=\{adv\.opps\}/.test(strip(src.weekly))
    && /aria-label=\{L\("Staff this week"/.test(src.weekly) && /\{companyView && <SalesPerformanceCard /.test(strip(src.salesViews)));
  /* v1.292.0 - the CEO (12-11-2026): no "Executive Command Center 4.0" and no line under it on the Dashboard */
  const eh = ov.slice(ov.indexOf("export function ExecHeader("), ov.indexOf("export type { MyShift"));
  ok("the Dashboard carries no Command Center title and no subtitle; the header is the phone's view switch only",
    eh.length > 200 && !/Command Center|key decisions and next actions/.test(ov + cards + dash) && /className=\{`\$\{x\.execHead\} erp-phone-only`\} data-testid="exec-header"/.test(eh) && !/<h1|<h2/.test(eh));
  ok("the source module of each decision is named in words", /export const deskBucketWord = /.test(src.desk) && /source: deskBucketWord\(d\.bucket\)/.test(ovBlock));
  return res;
}

const base = Object.fromEntries(Object.entries(FILES).map(([k, p]) => [k, read(p)]));
const res = checks(base);
let failed = res.filter(([, c]) => !c);
for (const [n, c, d] of res) if (!c) console.log(`  ✗ ${n}${d ? `  [${d}]` : ""}`);

/* the mutation pass: each breakage must be caught */
const MUT = [
  ["\"Verified\" claimed always", "ov", 'const owedLabel = verifying ? L("Verified outstanding", "Tertunggak disahkan") : L("Outstanding", "Tertunggak");', 'const owedLabel = L("Verified outstanding", "Tertunggak disahkan");'],
  ["company sales titled Collected", "ov", 'label={L("Company sales", "Jualan syarikat")} value={fmtRM(c.basis_cents)}', 'label={L("Collected", "Dikutip")} value={fmtRM(c.basis_cents)}'],
  ["a failed outstanding shown as RM 0", "ov", 'value={pw ? fmtRM(pw.outstanding.cents) : perfWeek.failed ? L("Not available", "Tiada data") : "—"}', 'value={pw ? fmtRM(pw.outstanding.cents) : fmtRM(0)}'],
  ["decisions counted from another list", "ov", "value={desk.data ? decide.length :", "value={desk.data ? desk.data.total :"],
  ["quoted value said to be revenue", "cards", 'L("quoted value (not revenue)", "nilai sebut harga (bukan hasil)")', 'L("quoted value", "nilai sebut harga")'],
  ["the alert band always drawn", "ov", "{alerts.length > 0 && <div className={x.span3} style={o(0)}><AlertBand alerts={alerts} /></div>}", "<div className={x.span3} style={o(0)}><AlertBand alerts={alerts} /></div>"],
  ["more than four actions", "ov", "<div className={x.span3} style={o(5)}><QuickActionsStrip actions={quick} max={4} /></div>", "<div className={x.span3} style={o(5)}><QuickActionsStrip actions={quick} /></div>"],
  ["the attendance chart dropped from Attendance", "att", "<DailyAttendanceChart role={user.role} />", ""],
  ["the pace worked out in the browser", "cards", 'if (w.risk === "high") return { text: L("Below target"', 'if ((w.pct ?? 0) < 50) return { text: L("Below target"'],
  ["the Command Center title brought back", "ov", '<div className={`${x.execHead} erp-phone-only`} data-testid="exec-header">', '<div className={`${x.execHead} erp-phone-only`} data-testid="exec-header"><h1>Executive Command Center 4.0</h1>'],
  ["the header drawn on a wide screen too", "ov", '<div className={`${x.execHead} erp-phone-only`} data-testid="exec-header">', '<div className={x.execHead} data-testid="exec-header">'],
  ["a company figure on My Day", "ov", "<NextActionsCard rows={rows} loaded={tasksLoaded} />", "<NextActionsCard rows={rows} loaded={tasksLoaded} />{fmtRM(c.basis_cents)}"],
];
let caught = 0;
for (const [name, file, from, to] of (process.env.NOMUT === "1" ? [] : MUT)) {
  if (!base[file].includes(from)) { console.log(`  ✗ mutation anchor missing: ${name}`); failed = [...failed, [name]]; continue; }
  const r = checks({ ...base, [file]: base[file].replace(from, to) });
  if (r.some(([, c]) => !c)) caught++;
  else { console.log(`  ✗ mutation NOT caught: ${name}`); failed = [...failed, [name]]; }
}
if (failed.length) { console.log(`\necc4: ${failed.length} failed`); process.exit(1); }
console.log(`ecc4: ${res.length} checks passed${process.env.NOMUT === "1" ? " (mutation pass skipped)" : ` (${caught} mutations caught)`}`);

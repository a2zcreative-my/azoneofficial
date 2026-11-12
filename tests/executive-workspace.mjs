/* v1.279.0 - A2Z OS MINIMAL EXECUTIVE WORKSPACE, phase E1: tokens and shell
   (claude/MINIMAL-EXECUTIVE-WORKSPACE-BLUEPRINT.md; the CEO, 11-11-2026:
   "Approve for all").

   What this holds, in the source (the browser half is tests/browser/
   shell-e1.py):
     - the rail draws the photo's modules and puts the rest under More,
       presentation only - the same permission-filtered items, the icon-only
       rail, the phone's More sheet and search still list every tab;
     - Projects is a shortcut into Tasks > Projects, drawn only for someone
       who may open Tasks and holds project_view - one rule (lib/caps.ts)
       shared with the Tasks page;
     - the header keeps search, the bell, Help and dark mode; sound, push,
       language, colour theme and Sign out are on the name card's menu and
       still in the phone's More sheet, through ONE set of handlers;
     - the active rail item keeps navy ink on gold (decision 5), never white;
     - the KPI tile is the photo's: 52px well, 22px figure, the change as a pill.
   E2 (v1.280.0), the Dashboard (browser half: tests/browser/dashboard-e2.py;
   the route against the whole worker: tests/company-performance.mjs):
     - the cards only draw; the one new read is the approved, management-only,
       GET-only route in the week engine;
     - the tick opens the update sheet; Snooze is this device's only;
     - every card of before is still there, behind More;
     - a phone leads with the target, then the decision or the next action.
   E3 + E4 (v1.281.0), the Sales Overview and the two record sheets (browser
   halves: tests/browser/sales-e3.py, tests/browser/sheets-e4.py).

     node tests/executive-workspace.mjs */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
let passed = 0, failed = 0;
const ok = (name, cond, detail = "") => { if (cond) passed++; else { failed++; console.log(`  ✗ ${name}${detail ? `  [${String(detail).slice(0, 300)}]` : ""}`); } };

const nav = read("components/layout/side-nav.tsx");
const navCss = read("components/layout/side-nav.module.css");
const shell = read("components/portal/portal-shell.tsx");
const v3 = read("styles/erp-v3.css");
const caps = read("lib/caps.ts");
const tasks = read("components/portal/tasks.tsx");
const registry = read("lib/portal-tabs.ts");

/* ---- the rail ---- */
const primM = nav.match(/export const RAIL_PRIMARY: ReadonlySet<string> = new Set\(\[([\s\S]*?)\]\);/);
const primary = primM ? [...primM[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]) : [];
const PHOTO = ["Dashboard", "Desk", "Sales", "Ecommerce", "Agents", "Tasks", "Inventory", "HR", "Attendance", "Leave", "Claims", "Payroll", "Finance", "Accounting", "Commission"];
ok("the rail's primary modules are the photo's, in the photo's order", JSON.stringify(primary) === JSON.stringify(PHOTO), primary.join(", "));
const allTabs = [...(registry.match(/const ALL_TABS = \[([\s\S]*?)\] as const;/)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
ok("every primary module is a real tab (the rail invents nothing)", primary.every((t) => allTabs.includes(t)));
ok("Revenue reads Sales, Ecommerce, Agents, Financial Advisory in the registry and the rail", allTabs.indexOf("Sales") < allTabs.indexOf("Ecommerce") && allTabs.indexOf("Ecommerce") < allTabs.indexOf("Agents") && /\{ title: "Revenue", tabs: \["Sales", "Ecommerce", "Agents", "Financial Advisory"\] \}/.test(nav));
const body = strip(nav);
ok("More holds every other tab the person may open (from the same filtered items)", /const moreItems = photoRail \? railGroups\.flatMap\(\(g\) => g\.items\.filter\(\(i\) => !RAIL_PRIMARY\.has\(i\.name\)\)\) : \[\];/.test(body));
ok("More stays open while it holds the open tab", /const moreOpen = moreOpenState \|\| moreHoldsActive;/.test(body));
ok("the icon-only rail and the /admin, /account rails keep every item (no More there)", /const photoRail = portalRail && !collapsed;/.test(body) && /const shown = photoRail \? section\.items\.filter\(\(i\) => RAIL_PRIMARY\.has\(i\.name\)\) : section\.items;/.test(body));
ok("the phone's More sheet still groups EVERY tab from SECTIONS (not the rail's cut)", /const mobileGroups = SECTIONS\.map/.test(read("components/portal/portal-provider.tsx")));
ok("Projects is a shortcut, never aria-current, and opens Tasks > Projects", /const projectsButton = onProjects \?/.test(body) && !/key="__projects"[\s\S]{0,200}aria-current/.test(body)
  && /onProjects=\{showProjects \? \(\) => \{ setTabStart\(\{ tab: "Tasks", view: "projects" \}\); setTab\("Tasks"\); \} : undefined\}/.test(shell));
ok("Projects is drawn only for someone who may open Tasks AND holds project_view", /const showProjects = canOpen\("Tasks"\) && canViewProjects\(user\.role\);/.test(shell));
ok("ONE projects rule, shared by the shortcut and the Tasks page", /export function canViewProjects\(role[^)]*\): boolean \{\s*return holds\("project_view",/.test(caps) && /const canProjects = canViewProjects\(user\.role\);/.test(tasks) && !/holds\("project_view"/.test(strip(tasks)));
ok("the Home group is drawn without a heading but keeps its name for a screen reader", /const UNTITLED_GROUP = "Home";/.test(nav) && /\$\{untitled \? "erp-sr-only" : ""\}/.test(nav));
ok("a fold button is still named as a group (\"Finance group\")", /`\$\{sectionTitle\(section\.title, lang\)\} group`/.test(nav));

/* ---- the active pill: navy on gold (decision 5) ---- */
const active = v3.match(/\.erp-rail-item\[aria-current="page"\] \{([^}]*)\}/)?.[1] ?? "";
ok("the current tab is a gold pill with NAVY ink (5.4:1), never the photo's white (2.3:1)", /background: var\(--gold-solid\)/.test(active) && /color: var\(--brand-primary\)/.test(active) && !/color: (#fff|white|var\(--card\))/.test(active), active);
ok("rail rows are 34px for a mouse and 44px for a touch screen", /min-height: 2\.125rem;/.test(v3) && /@media \(pointer: coarse\) \{ \.erp-rail-item \{ min-height: 44px; \} \}/.test(v3));

/* ---- the name card and its menu ---- */
ok("the name card opens the account menu (aria-expanded, Escape and a click outside close it)",
  /aria-expanded=\{menuOpen\} aria-controls="rail-account-menu"/.test(nav) && /e\.key === "Escape"\) \{ setMenuOpen\(false\); menuButtonRef\.current\?\.focus\(\); \}/.test(nav) && /addEventListener\("mousedown", onDown\)/.test(nav));
ok("a setting in the menu says On / Off and stays open; Sign out closes it first", /aria-pressed=\{a\.pressed\}/.test(nav) && /if \(a\.pressed === undefined\) closeMenu\(\);/.test(nav) && /onClick=\{\(\) => \{ closeMenu\(\); a\.onSelect\(\); \}\}/.test(nav));
for (const k of ["sound", "push", "lang", "theme", "signout"]) ok(`the account menu carries "${k}"`, new RegExp(`key: "${k}"`).test(shell));
ok("the More sheet and the account menu share ONE set of handlers", ["toggleSound", "togglePush", "toggleLang", "signOut"].every((h) => new RegExp(`const ${h} = `).test(shell) && (shell.match(new RegExp(`\\b${h}\\b`, "g")) ?? []).length >= 3)
  && (shell.match(/localStorage\.setItem\("azone-notif-sound"/g) ?? []).length === 1 && (shell.match(/await enablePush\(\)/g) ?? []).length === 1 && (shell.match(/signOutRequest\(\)/g) ?? []).length === 1);

/* ---- the header ---- */
const hdr = shell.slice(shell.indexOf('<header className="erp-topbar"'), shell.indexOf("</header>"));
ok("the header keeps search, the bell, Help and dark mode", /Search the portal/.test(hdr) && /Notifications/.test(hdr) && /aria-label=\{L\("Help", "Bantuan"\)\}/.test(hdr) && /Toggle dark mode/.test(hdr));
ok("the header no longer carries sound, push, colour theme, language or Sign out", !/Mute notification sound|Toggle push alerts|Switch colour theme|Toggle language|tr\("Sign out", lang\)/.test(strip(hdr)));
ok("the header draws no avatar (the photo is on the name card)", !/css\.avatar/.test(strip(hdr)));
ok("Help opens the Help sheet, from the header and from the phone's More sheet", /<HelpSheet open=\{helpOpen\}/.test(shell) && /setMoreOpen\(false\); setHelpOpen\(true\);/.test(shell));
const help = read("components/portal/help-sheet.tsx");
ok("the Help sheet is a SideDrawer that names no number or reply time it cannot keep", /<SideDrawer /.test(help) && !/\+?6?0\d{1,2}[- ]?\d{3,4}[- ]?\d{4}|within \d+ (hours|minutes)/.test(help));
ok("the page title is the photo's 27px / 700", /--type-page-size: 1\.6875rem;\s*--type-page-weight: 700;/.test(read("styles/globals.css")));

/* ---- the KPI tile ---- */
const kt = read("components/ui/kpi-tile.module.css");
ok("the KPI tile is the photo's: 52px well, 28px icon, 13px label, 9px bar", /\.well \{[^}]*width: 3\.25rem;[^}]*height: 3\.25rem;/.test(kt) && /\.well :global\(\.erp-icon\) \{\s*width: 1\.75rem;/.test(kt) && /\.label \{\s*font-size: 0\.8125rem;/.test(kt) && /\.bar \{[^}]*height: 0\.5625rem;/.test(kt));
const tile = read("components/ui/kpi-tile.tsx");
ok("the change is a pill with the comparison beside it", /<span className=\{delta\.pct >= 0 \? css\.up : css\.down\}>/.test(tile) && /\{delta\.vs && <span>\{delta\.vs\}<\/span>\}/.test(tile) && /\.up \{\s*background: var\(--success-soft\);/.test(kt));
ok("a change is still never drawn without a comparison (null pct = nothing)", /delta && delta\.pct != null && !busy/.test(tile));
/* ---- E2 (v1.280.0): the Dashboard ---- */
const cards = read("components/portal/executive-cards.tsx");
const cardsCode = strip(cards);
const ovSrc = read("components/portal/dashboard-overview.tsx");
const ovCode = strip(ovSrc);
const ws = read("worker/src/weekly-sales.ts");
ok("the Dashboard's cards only draw: no request is written from them (no POST, PATCH, PUT or DELETE)", !/method:\s*"(POST|PATCH|PUT|DELETE)"/.test(cardsCode) && !/\bapi\(/.test(cardsCode));
ok("the one new read is the approved route, read through the shared cache", /export const PERFORMANCE_PATH = "\/staff\/sales\/week\/performance";/.test(cards) && /useCachedApi<Performance>\(enabled \? `\$\{PERFORMANCE_PATH\}\?period=\$\{period\}` : null/.test(cards));
ok("the route is management only and GET only, in the week engine (no second engine)", /if \(path === "\/sales\/week\/performance" && method === "GET"\) return companyPerformance\(env, user, params\);/.test(ws)
  && /if \(!VIEW_ALL\(user\)\) return err\("forbidden", "Company sales are for management", 403\);/.test(ws) && !/INSERT|UPDATE|DELETE/.test(ws.slice(ws.indexOf("async function companyBasisByDay"), ws.indexOf("/** v1.239.0 - what else was sold"))));
ok("only management asks for it (exec = the week engine's outlook)", /const exec = Boolean\(wk\?\.outlook\);/.test(ovCode) && /const perfWeek = usePerformance\("week", exec\);/.test(ovCode) && /\{exec \? \(/.test(ovCode) && (ovCode.match(/<SalesPerformanceCard /g) ?? []).length === 1);
ok("a task's tick opens its update sheet - it never closes a task", /const openTask = \(id: number\) => \{ openRecord\("Tasks", "task", id\); go\("Tasks"\); \};/.test(ovCode) && /onClick=\{\(\) => onOpen\(t\.id\)\}/.test(cards) && !/completed|status:/.test(cardsCode.slice(cardsCode.indexOf("export function MyTasksCard"), cardsCode.indexOf("export interface FollowLite"))));
ok("Snooze hides the next best action on this device until tomorrow and tells the server nothing", /const SNOOZE_KEY = "azone-nba-snoozed";/.test(cards) && /window\.localStorage\.setItem\(SNOOZE_KEY/.test(cards) && /snoozed\[c\.key\]! >= today/.test(cards));
ok("a day to come is drawn as nothing, and a failed read says so with Retry", /val !== null && val > 0 && <rect/.test(cards) && /<ErrorState title=\{L\("The sales figures could not be loaded"/.test(cards) && /onRetry=\{v\.refresh\}/.test(cards));
ok("the chart has its figures as a table for a screen reader, and the period is a radio group", /<table className="erp-sr-only">/.test(cards) && /role="radiogroup"/.test(read("components/ui/segmented.tsx")) && /aria-checked=\{k === value\}/.test(read("components/ui/segmented.tsx")));
ok("every card of before is still on the Dashboard, behind More", ["{rowsAB.map", "{taskCard}", "{teamCard}", "{salesCard}", "{activityCard}", "{livesCard}", "{shiftCard}", "<LeaveMonthCard go={go} />", "{summaryCard}", "{statusCard}"].every((t) => ovSrc.slice(ovSrc.indexOf('id="dash-more"')).includes(t)));
ok("the header's date pill only chooses the day Today's Schedule shows", /const day = dashDate \?\? today;/.test(ovCode) && /onChange=\{\(e\) => setDashDate\(e\.target\.value && e\.target\.value !== today \? e\.target\.value : null\)\}/.test(read("components/portal/portal-shell.tsx")));
ok("a phone leads with the target and then the decision (CEO) or the next best action (staff)", /\{hero && <div className=\{x\.phoneOnly\} style=\{o\(0\)\}/.test(ovSrc) && /approvalsCard && <div style=\{o\(1\)\}>/.test(ovSrc) && /nba\.length > 0 && <div style=\{o\(1\)\}>/.test(ovSrc));
ok("the runtime guard for the route is registered", /\["company-performance", "/.test(read("scripts/run-guards.mjs")));
/* ---- E3 (v1.281.0): the Sales Overview ---- */
const sales = read("components/portal/sales.tsx");
const salesCode = strip(sales);
const sw = read("components/portal/sales-workspace.tsx");
ok("Sales shows the photo's five figures, Verified only while the CEO verifies payments", /label=\{pv\?\.on \? L\("Collected \(Verified\)"/.test(salesCode) && /label=\{L\("Reported, not verified"/.test(salesCode) && /label=\{L\("Outstanding", "Tertunggak"\)\}/.test(salesCode) && /label=\{L\("Open Quotations"/.test(salesCode));
ok("Reported, not verified is read from the Payments queue, and only where Payments is read (the invoice_payment roles and, since 1.285.0, the CCO)", /\{pv\?\.on && pv\.pend \? \(/.test(salesCode) && /pend: \{ cents: Number\(pr\.data\.tiles\?\.pending_cents \?\? 0\)/.test(salesCode) && /if \(paysByReport\) \{\s*const pr = await api/.test(salesCode) && /paysByReport = canPay \|\| user\.role === "cco"[,;]/.test(salesCode));
ok("Record payment only where the server says a payment may be reported (the list's own rule)", /const canRecord = p\.canPay && pv\?\.on && v\?\.can_report === true;/.test(sw) && /<NeedsActionCard loaded=\{loaded\} data=\{\{ unpaid: unpaidInv, followups: dueFollow, pv, partPaid, canPay: paysByReport, today, who: payWho \}\}/.test(salesCode));
ok("Needs action draws; Sales hands each row its one existing action", /export function NeedsActionCard/.test(sw) && !/\bapi\(/.test(strip(sw.slice(sw.indexOf("export function NeedsActionCard")))) && /onRecord=\{\(d\) => \{ setRecordInv\(d\.id\); setWsView\("payments"\); \}\}/.test(salesCode) && /onFollow=\{\(f\) => openCustomerFile\(f\.customer_id, f\.company,/.test(salesCode) && /label: L\("Follow up", "Susuli"\), on: \(\) => p\.onFollow\(f\)/.test(sw));
ok("the company's week sits beside it only for management on Everyone", /const companyView = Boolean\(weekDash\?\.outlook\) && scope === "all";/.test(salesCode) && /\{companyView && <SalesPerformanceCard /.test(salesCode));
ok("the tabs count what waits; a phone reads Documents and Create", /\["documents", L\("Quotations & Invoices", "Sebut Harga & Invois"\), loaded \? /.test(salesCode) && /L\("Documents", "Dokumen"\)\]/.test(salesCode) && /<span className="erp-phone-only">\{L\("Create", "Cipta"\)\}<\/span>/.test(salesCode) && /\{short \? <><span className="erp-desktop-only">\{text\}<\/span><span className="erp-phone-only">\{short\}<\/span><\/> : text\}/.test(read("components/ui/line-tabs.tsx")));
ok("the month's two figures the tiles gave way to are still said, in one line", /data-testid="sales-month-line"/.test(sales));
/* ---- E4 (v1.281.0): the task sheet and the payment verification sheet ---- */
const tp = read("components/portal/task-progress.tsx");
const tpCode = strip(tp);
const pp = read("components/portal/payments-panel.tsx");
const ppCode = strip(pp);
const lt = read("components/ui/line-tabs.tsx");
ok("the task sheet opens full screen on a phone", /<SideDrawer open onClose=\{closeDetail\} wide full title=\{t\.title\}/.test(read("components/portal/tasks.tsx")));
ok("Details leads with the latest update, then the stages and the decisions (all kept)", /\{tab === "details" && <StatusSummary d=\{d\} tick=\{tick\} onSeeAll=\{\(\) => setTab\("updates"\)\} \/>\}\s*<ReviewBar /.test(tpCode) && /<StageTimeline stages=\{stages\} label=\{L\("Task progress"/.test(tpCode) && /acknowledged: \["Acknowledged"/.test(tp));
ok("the gold Add update opens the update sheet and nothing else", /onClick=\{\(\) => setSheet\(true\)\} data-testid="add-update"><AppIcon name="chat" className="erp-icon" \/>\{L\("Add update"/.test(tpCode));
ok("the payment sheet's foot carries the first waiting payment's decision; that payment loses its inline copies", /const lead = pic && data\.can\.verify \? pic\.reports\.find\(\(r\) => isPending\(r\)\) \?\? null : null;/.test(ppCode) && /footer=\{act \? undefined : lead \? \(/.test(ppCode) && (ppCode.match(/r\.id !== lead\?\.id/g) ?? []).length === 3);
/* v1.285.0 (the CEO, 12-11-2026: "If I update the paid status, no further verification are required") - the owner verifies any waiting payment, his own included */
ok("the foot's Verify follows the 1.285 rule (the CEO, his own report included; nobody else)", /const mayVerify = \(r: Rep\) => data\.can\.verify && isPending\(r\);/.test(ppCode)
  && /const canVerify = data\.can\.verify && pending;/.test(ppCode));
ok("Verify, Reject and Reverse still need the authenticator code; a question is still words", /const needsCode = act && \["verify", "reject", "reverse", "evidence"\]\.includes\(act\.mode\);/.test(ppCode) && /act\.mode === "clarify" \? \{ question: text\.trim\(\) \}/.test(ppCode));
ok("'Request clarification' reads 'Ask a question' (decision 6)", !/Request clarification/.test(ppCode) && (ppCode.match(/L\("Ask a question", "Tanya soalan"\)/g) ?? []).length === 2);
/* v1.282.0 (Payment Verification 3.0, brief section 6): the sheet shows VERIFIED outstanding - pending is never taken off it */
const parts = strip(read("components/portal/payment-parts.tsx"));
ok("the sheet's outstanding is the verified outstanding: total less verified money, pending never deducted", /const outstanding = paid \? 0 : Math\.max\(0, total - verified\);/.test(parts) && !/afterVerify|total - verified - pending/.test(ppCode + parts) && /<AmountSummary total=\{pic\.invoice\.total_cents\} verified=\{pic\.verified_cents\} pending=\{pic\.pending_cents\}/.test(ppCode));
ok("a tab's name is its word; the count is an aria-hidden badge read as its description", /aria-describedby=\{n \? `\$\{uid\}-\$\{k\}-n` : undefined\}/.test(lt) && /id=\{`\$\{uid\}-\$\{k\}-n`\} aria-hidden="true"/.test(lt) && !/aria-label=\{`, \$\{n\}`\}/.test(lt));
ok("the guard is registered", /\["executive-workspace", "/.test(read("scripts/run-guards.mjs")));

console.log(`  ${passed} check(s) passed.`);
if (failed) { console.log(`\n${failed} check(s) failed.`); process.exit(1); }

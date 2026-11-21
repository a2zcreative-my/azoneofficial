/* 21-11-2026 (the CEO: "check globally for all the tabs, ensure that strip KPI card above while sub tabs
   at downside", the Sales > Payments page as the reference). A page's MAIN tab row stays on top (the
   Payments page: Overview · Quotations & Invoices · Payments ...); inside a view, its figure strip comes
   FIRST and its sub-tab row UNDER it. The screens that had it the other way round, and how each holds it:
   - Sales > Leads & CRM: the four lead views and Business Growth draw the sub-tab row under their strip
     (the row is ONE element, custFilterBar, handed in as `tabs`); views with no strip keep it on top;
   - Users > Staff accounts and Customers & Agents: the Staff / Customers switch under the figures;
   - Financial Advisory > Bankers: Directory / Branches / Banks / History under the banker counts.
   Source order only - the figures, the tabs and their gates are the same elements as before. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) passes++; else { fails++; console.log(`  x ${m}`); } };
const before = (src, a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); return i >= 0 && j > i; };

const crm = read("components/portal/crm-leads.tsx");
const growth = read("components/portal/growth-enquiries.tsx");
const sales = read("components/portal/sales.tsx");
const users = read("components/portal/users-panel.tsx");
const cust = read("components/portal/customers-agents.tsx");
const fa = read("components/portal/fa-registry.tsx");

ok(/testid="crm-strip" \/>\n\s*\{tabs\}/.test(crm), "Leads & CRM: the lead views draw the sub-tab row right under their figure strip");
ok(/return <>\{tabs\}<p className=\{css\.warn\} role="alert" data-testid="leads-failed">/.test(crm), "Leads & CRM: a lead list that fails to load still shows the sub-tab row");
ok(/testid="growth-strip" \/>\n\s*\{leadTabs\}/.test(growth), "Business Growth: the sub-tab row right under its figure strip");
ok((growth.match(/return <>\{leadTabs\}<p/g) ?? []).length === 2, "Business Growth: failed / pending still show the sub-tab row");
ok(/const custFilterBar = \(\n\s*<CustomerFilterBar /.test(sales) && (sales.match(/<CustomerFilterBar /g) ?? []).length === 1, "Sales: the Leads & CRM sub-tab row is one element");
ok(/\{!\(LEAD_FILTER\[custFilter\] \|\| custFilter === "action" \|\| \(seesGrowth && custFilter === "growth"\)\) && custFilterBar\}/.test(sales), "Sales: on top only for a view with no figure strip");
ok(/onOpenDeal=\{openDeal\} tabs=\{custFilterBar\} \/>/.test(sales) && /<GrowthEnquiries [^\n]*tabs=\{custFilterBar\}/.test(sales), "Sales: the lead views and Business Growth receive it");
ok(before(users, 'testid="staff-figures"', "<div className={css.partBar}>{partSwitch}</div>") && !/\{partSwitch\}\n\s*<button type="button" className=\{btnSm\} data-testid="users-export"/.test(users), "Users > Staff: the figures, then the Staff / Customers switch");
ok(/tabs=\{<div className=\{css\.partBar\}>\{partSwitch\}<\/div>\}/.test(users) && /<\/KpiRow>\n\s*\{tabs\}\n\s*<WorkspaceSplit testid="customers-split"/.test(cust), "Users > Customers & Agents: the figures, then the switch");
ok(before(fa, '<KpiRow label={L("Banker counts", "Kiraan pegawai bank")}>', "{tabs}") && /\{\(sub !== "directory" \|\| failed \|\| !data\) && subTabs\}/.test(fa) && /tabs=\{subTabs\}/.test(fa), "Financial Advisory > Bankers: the banker counts, then the sub-tab row");

if (fails) { console.log(`\nstrip-before-subtabs: ${fails} failed, ${passes} passed.`); process.exit(1); }
console.log(`PASS - figure strips above sub-tab rows on Leads & CRM, Business Growth, Users and Bankers (${passes} checks)`);

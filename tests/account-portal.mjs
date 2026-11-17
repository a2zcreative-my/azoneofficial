/* v1.343.0 - THE CLIENT AREA IN THE PORTAL'S CONCEPT (the CEO, 17-11-2026:
   "for customer account, make it standardize as my /portal interface UI/UX!").

   /account keeps the portal chrome (ConsoleShell) and now draws its three
   sections the portal's way: a TabPage of captioned zones, ONE connected KPI
   strip per section, titled panes, the portal's register for records, and a
   CSS Module instead of hand-written utility classes. It reads and sends
   exactly what it did: GET /account/orders, GET /account/enquiries, POST
   /account/enquiries, and the customer-only redirect.

   Usage: node tests/account-portal.mjs   (NOMUT=1 skips the mutations) */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const page0 = readFileSync(join(root, "app/account/page.tsx"), "utf8");
const css0 = readFileSync(join(root, "app/account/account.module.css"), "utf8");

function run(page, css) {
  const f = [];
  const t = (n, c) => { if (!c) f.push(n); };
  const strips = (page.match(/<KpiRow /g) ?? []).length;
  t("A1 the portal chrome stays (ConsoleShell) and every section is a TabPage of zones",
    /<ConsoleShell\b/.test(page) && (page.match(/<TabPage /g) ?? []).length === 3 && /<TabZone /.test(page));
  t("A2 one connected KPI strip per section, no stand-alone figure cards", strips === 3 && !/tileCard|className=\{card\}/.test(page));
  t("A3 records in the portal's register (orders, live sessions); the work in titled panes",
    /<CompactTaskTable rows=\{docRows\}/.test(page) && /<CompactTaskTable rows=\{liveRows\}/.test(page) && /<WorkspaceSplit testid="account-split"/.test(page) && /<WorkspaceSplit testid="enquiries-split"/.test(page));
  t("A4 the same reads and the same send - nothing new fetched",
    (page.match(/api<[^>]*>\("\/account\/orders"\)/g) ?? []).length === 1 && (page.match(/"\/account\/enquiries"\)/g) ?? []).length === 2
    && /csrfFetch\("\/api\/v1\/account\/enquiries", \{\s*method: "POST"/.test(page) && !/\bapi(?:<[^>]*>)?\("\/(?!account\/|auth\/)/.test(page));
  t("A5 the customer-only door and the Google-sign-in password rule are kept",
    /if \(r\.data\.user\.role !== "customer"\)/.test(page) && /\{user\.oauth \? \(/.test(page) && /<ChangePasswordForm \/>/.test(page) && /<GoogleConnectPanel \/>/.test(page));
  t("A6 the figures come only from the page's own reads", /const unpaid = invoices\.filter\(\(d\) => !isPaid\(d\)\);/.test(page) && /const awaiting = enq\.filter/.test(page));
  t("A7 no hand-written utility classes; the module uses tokens, no colour but the logo's white backing",
    !/className="(?:[^"]*\s)?(?:mt-\d|mb-\d|text-sm|text-xs|grid-cols|flex|space-y|rounded|border-border|bg-secondary)/.test(page)
    && !/#[0-9a-f]{3,6}\b/i.test(css.replace(/background: #fff;/g, "")));
  return f;
}
const fails = run(page0, css0);
for (const n of fails) console.log(`  ✗ ${n}`);
let caught = 0;
const MUT = [
  ["a figure card stacked beside the strip", "page", '<TabZone label={L("Records", "Rekod")}>', '<TabZone label={L("Records", "Rekod")}><div className={card} />'],
  ["a second strip", "page", '<TabZone label={L("Ask and follow up", "Tanya dan susuli")}>', '<TabZone label={L("Ask and follow up", "Tanya dan susuli")}><KpiRow label="x">{null}</KpiRow>'],
  ["a new read", "page", 'void api<{ enquiries: Enquiry[] }>("/account/enquiries").then((e) =>', 'void api("/staff/users"); void api<{ enquiries: Enquiry[] }>("/account/enquiries").then((e) =>'],
  ["staff let in", "page", 'if (r.data.user.role !== "customer") {', 'if (false) {'],
  ["a utility class back", "page", '<p className={css.privacy}>', '<p className="mt-6 text-xs">'],
];
if (!process.env.NOMUT) for (const [n, k, a, b] of MUT) {
  const src = { page: page0, css: css0 };
  if (!src[k].includes(a)) { fails.push(`anchor missing: ${n}`); console.log(`  ✗ anchor missing: ${n}`); continue; }
  src[k] = src[k].replace(a, b);
  if (run(src.page, src.css).length) caught++; else { fails.push(`not caught: ${n}`); console.log(`  ✗ mutation not caught: ${n}`); }
}
if (fails.length) { console.log(`account-portal: ${fails.length} failed`); process.exit(1); }
console.log(`account-portal: 7 checks passed (${caught} mutations caught) - the client area is the portal's pages, on the same reads`);

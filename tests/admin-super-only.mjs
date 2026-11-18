/* v1.348.0 - /ADMIN IS THE SUPER ADMIN'S CONSOLE (the CEO, 17-11-2026:
   "make sure that /Admin are totally super admin control in the system which is
   secured!"; his answers: the owner's role-giving moves to portal Users, the
   admin role loses /admin, the website editor stays in /admin, Enquiries is
   retired).

   Holds:
     A1 the page opens for role super_admin only - a customer goes to /account,
        every other role (the owner CEO and the admin role included) to /portal
     A2 the retired tabs stay retired (Enquiries, Staff), the signature vault
        is its own tab, the website editor and its content tabs stay
     A3 the server refuses the website content to every role but super_admin
        (content_manage), and the signature vault to the admin role
     A4 the owner keeps giving and taking roles in portal Users, through the
        same server rule (roleChangeRule) - nothing was lost by the move
     A5 /admin/permissions only redirects to portal Users → Roles & Permissions

   Run: node tests/admin-super-only.mjs */
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const src = {
  admin: read("app/admin/page.tsx"),
  perm: read("worker/src/permissions.ts"),
  staff: read("worker/src/staff.ts"),
  users: read("components/portal/users-panel.tsx"),
  permPage: read("app/admin/permissions/page.tsx"),
  overview: read("components/admin/admin-overview.tsx"),
  usersPage: read("components/admin/admin-users.tsx"),
  security: read("components/admin/admin-security.tsx"),
  account: read("components/admin/admin-account.tsx"),
  vault: read("components/admin/signatures-panel.tsx"),
  website: read("components/admin/admin-website.tsx"),
};
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

function checks(s) {
  const f = [];
  const t = (name, ok) => { if (!ok) f.push(name); };
  const page = strip(s.admin);
  const gate = page.slice(page.indexOf("export default function AdminPage("));
  t("A1 /admin opens for super_admin only; the rest go to /portal or /account",
    /if \(user\.role === "customer"\) \{\s*if \(typeof window !== "undefined"\) window\.location\.replace\("\/account"\);/.test(gate)
    && /if \(user\.role !== "super_admin"\) \{\s*if \(typeof window !== "undefined"\) window\.location\.replace\("\/portal"\);\s*return <AdminPageSkeleton \/>;/.test(gate)
    && !/ownerCeo/.test(gate) && !/PORTAL_ROLES/.test(page));
  const tabs = page.slice(page.indexOf("const TABS = ["), page.indexOf("] as const;", page.indexOf("const TABS = [")));
  t("A2 Enquiries and Staff retired; Signatures its own tab; the website editor stays",
    !/"Enquiries"|"Staff"/.test(tabs) && /"Signatures"/.test(tabs) && ["Website", "Users", "Audit", "Account"].every((n) => tabs.includes(`"${n}"`))
    && /\{tabNow === "Signatures" && <SignaturesPanel \/>\}/.test(page) && !/<Enquiries \/>|<StaffPanel|<HrAdminPanel|<StaffDirectory/.test(page));
  t("A3 the website content is the super admin's only (content_manage)", /^\s*content_manage: \["super_admin"\],/m.test(s.perm));
  const vault = s.staff.slice(s.staff.indexOf("const sigUpload = path.match("), s.staff.indexOf('if (path === "/signatures" && method === "GET")') + 300);
  t("A3 the signature vault refuses the admin role (upload and read)",
    (vault.match(/if \(!\["super_admin", "ceo"\]\.includes\(user\.role\)\)/g) ?? []).length === 2 && !/"admin"/.test(vault));
  t("A4 the owner gives and takes roles in portal Users through the server's roleChangeRule",
    /api\(`\/staff\/users\/\$\{u\.id\}\/role`, \{ method: "POST"/.test(s.users) && /roleChangeRule/.test(s.users));
  t("A5 /admin/permissions only redirects to portal Users → Roles & Permissions",
    /window\.location\.replace\("\/portal\?tab=Users&view=roles"\)/.test(s.permPage) && !/PERMISSIONS|can\(/.test(strip(s.permPage)));
  /* v1.349.0 - Phase 2: the Overview and Users on the portal's pages */
  t("P1 the console renders the new Overview and Users; the old panels are gone",
    /\{tabNow === "Dashboard" && <AdminOverview onOpen=/.test(page) && /\{tabNow === "Users" && <AdminUsers me=\{user\} \/>\}/.test(page) && !/function Dashboard\(|function UsersPanel\(/.test(page));
  t("P2 the Overview only reads (no write) and shows each read's own figure, saying when one failed",
    !/method:/.test(s.overview) && ["\"/users\"", "\"/staff/users\"", "\"/system/health\"", "\"/system/security\"", "\"/dashboard/summary\""].every((r) => s.overview.includes(r))
    && (s.overview.match(/L\("Not available", "Tiada data"\)/g) ?? []).length >= 4 && /<KpiRow /.test(s.overview) && (s.overview.match(/<KpiRow /g) ?? []).length === 1);
  t("P3 Users keeps every action on the same routes, the server deciding each",
    /api\("\/users", \{\s*method: "POST"/.test(s.usersPage) && (s.usersPage.match(/api(?:<[^>]*>)?\(`\/users\/\$\{u\.id\}`, \{\s*method: "PATCH"/g) ?? []).length === 3
    && /api\(`\/users\/\$\{u\.id\}\/revoke-sessions`, \{ method: "POST" \}\)/.test(s.usersPage) && (s.usersPage.match(/withStepUp</g) ?? []).length === 3 /* v1.358.0 - the third gives a role you made, on the staff role door */ && /api\(`\/staff\/users\/\$\{u\.id\}\/role`, \{\s*method: "POST", body: JSON\.stringify\(\{ role: to, reason: why\.value\.trim\(\)/.test(s.usersPage)
    && /<OwnerCard state=\{ownerState\}/.test(s.usersPage) && /if \(u\.is_active && !\(await confirm\(/.test(s.usersPage) && /if \(!\(await confirm\(\{ title: L\("Confirm Role Change"/.test(s.usersPage)
    && /disabled=\{self\}/.test(s.usersPage));
  /* v1.351.0 - Phase 3: Security & Audit, My Account and Signatures */
  t("P4 Security & Audit = the audit trail and the backup card behind one tab row, both kept mounted, the strip from server reads only",
    /\{tabNow === "Audit" && <AdminSecurity \/>\}/.test(page) && /<div hidden=\{view !== "trail"\}[^>]*><AuditPanel \/><\/div>/.test(s.security)
    && /<div hidden=\{view !== "backups"\}/.test(s.security) && /<SystemHealthCard \/>/.test(s.security) && !/method:/.test(s.security));
  t("P5 My Account keeps the same five panels; its strip only reads",
    /\{tabNow === "Account" && <AdminAccount onReload=/.test(page) && ["<ChangePasswordForm />", "<TwoFactorPanel onEnabled=", "<GoogleConnectPanel />", "<PasskeysPanel />", "<RecoveryPanel />"].every((x) => s.account.includes(x))
    && !/method:/.test(s.account) && /p\.available \? L\("Ready", "Sedia"\) : L\("Not ready", "Belum sedia"\)/.test(s.account));
  t("P6 Signatures keeps the vault's upload, history and full-size check; nothing deletes",
    /csrfFetch\(`\/api\/v1\/staff\/signatures\/\$\{entity\}\/\$\{r\.file\}`, \{\s*method: "POST"/.test(s.vault) && /<ChopZoom/.test(s.vault) && /setOpenHistory/.test(s.vault)
    && !/method: "DELETE"/.test(s.vault) && (s.vault.match(/<KpiRow /g) ?? []).length === 1);
  /* v1.352.0 - Phase 4: the six website tabs are one, Website Content */
  t("P7 Website Content is one tab: the five other website tabs are gone from the console",
    !/"Portfolio"|"Testimonials"|"Posts"|"Media"|"Advanced"/.test(tabs) && /\{tabNow === "Website" && <AdminWebsite \/>\}/.test(page) && !/function CrudPanel\(|function MediaPanel\(|function ContentPanel\(/.test(page));
  t("P8 every website view keeps its requests; a delete now asks first; the views stay mounted",
    /api\(`\/\$\{resource\}\/\$\{editingId\}`, \{ method: "PUT"/.test(s.website) && /api\(`\/\$\{resource\}`, \{ method: "POST"/.test(s.website)
    && /csrfFetch\(`\$\{API\}\/media\?filename=/.test(s.website) && /compressImage\(file\)/.test(s.website) && /api\(`\/content\/\$\{encodeURIComponent\(key\.trim\(\)\)\}`, \{ method: "PUT"/.test(s.website)
    && (s.website.match(/if \(!\(await confirm\(\{ title: L\("Delete|if \(!\(await confirm\(\{ title: L\(`Delete/g) ?? []).length === 2
    && ["text", "posts", "portfolio", "testimonials", "media", "keys"].every((v) => s.website.includes(`<div hidden={view !== "${v}"}`)) && (s.website.match(/<KpiRow /g) ?? []).length === 1);
  return f;
}

const fails = checks(src);
for (const n of fails) console.log(`  ✗ ${n}`);
let caught = 0;
const MUT = [
  ["the admin role let back in", "admin", 'if (user.role !== "super_admin") {', 'if (!["super_admin", "admin"].includes(user.role)) {'],
  ["Enquiries brought back", "admin", '  "Website",\n  "Users",', '  "Website",\n  "Enquiries",\n  "Users",'],
  ["content opened to the admin role again", "perm", 'content_manage: ["super_admin"],', 'content_manage: ["super_admin", "admin"],'],
  ["the role change no longer asks first", "usersPage", 'if (!(await confirm({ title: L("Confirm Role Change"', 'if (false && !(await confirm({ title: L("Confirm Role Change"'],
  ["the Overview writes", "overview", 'void api<Health>("/system/health")', 'void api<Health>("/system/health", { method: "POST" })'],
  ["the old Users panel left in the page", "admin", '/* ---------------- Users: components/admin/admin-users.tsx (v1.349.0) ---------------- */', 'function UsersPanel() { return null; }'],
  ["the backup view unmounted when hidden", "security", '<div hidden={view !== "backups"} data-testid="view-backups">', '{view === "backups" && <div data-testid="view-backups">'],
  ["My Account drops the recovery panel", "account", "        <RecoveryPanel />\n", ""],
  ["the vault grows a delete", "vault", 'method: "POST",\n      headers: { "Content-Type": "image/png" },', 'method: "DELETE",\n      headers: { "Content-Type": "image/png" },'],
  ["a website delete stops asking", "website", 'if (!(await confirm({ title: L("Delete this file?"', 'if (false && !(await confirm({ title: L("Delete this file?"'],
  ["Posts back as its own tab", "admin", '  "Website",\n  "Users",', '  "Website",\n  "Posts",\n  "Users",'],
  ["the vault opened to the admin role again", "staff", 'if (!["super_admin", "ceo"].includes(user.role)) {\n      return err("forbidden", "Only the super admin or the CEO can upload signatures"', 'if (!["super_admin", "admin", "ceo"].includes(user.role)) {\n      return err("forbidden", "Only the super admin or the CEO can upload signatures"'],
];
for (const [name, k, a, b] of MUT) {
  if (!src[k].includes(a)) { fails.push(`mutation anchor missing: ${name}`); console.log(`  ✗ mutation anchor missing: ${name}`); continue; }
  if (checks({ ...src, [k]: src[k].replace(a, b) }).length > 0) caught++; else { fails.push(`mutation not caught: ${name}`); console.log(`  ✗ mutation not caught: ${name}`); }
}
if (fails.length) { console.log(`admin-super-only: ${fails.length} failed`); process.exit(1); }
console.log(`admin-super-only: 14 checks passed (${caught} mutations caught) - /admin is the super admin's console, and the server agrees`);

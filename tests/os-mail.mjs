/* 18-11-2026 - ONE A2Z OS EMAIL LOOK (the CEO: "Email migrate I want to be the same template
   as reminder email!"). The task emails' frame lives in worker/src/mail.ts osMailHtml; the task
   emails and every staff account email (subject names "A2Z OS") are drawn in it. Customer and
   client emails never name "A2Z OS" and stay plain - a quotation of AZ ONE OFFICIAL must not
   wear A2Z Creative Marketing's header.

     node tests/os-mail.mjs        (NOMUT=1 skips the mutation pass) */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const F = { mail: "worker/src/mail.ts", task: "worker/src/task-mail.ts", staff: "worker/src/staff.ts", agent: "worker/src/agent.ts", index: "worker/src/index.ts" };

function checks(src) {
  const out = [];
  const ok = (name, cond) => out.push([Boolean(cond), name]);
  ok("the frame is drawn once, in mail.ts", /export function osMailHtml\(p: OsMailParts\): string/.test(src.mail) && /A2Z <span style="color:\$\{GOLD\}">OS<\/span>/.test(src.mail) && !/A2Z <span style="color:\$\{GOLD\}">OS<\/span>/.test(src.task));
  ok("the task emails use that frame", /const html = osMailHtml\(\{/.test(src.task) && /import \{[^}]*osMailHtml[^}]*\} from "\.\/mail"/.test(src.task));
  ok("a staff account email (subject names A2Z OS) is drawn in the frame", /const html = m\.html \?\? \(\/\\bA2Z OS\\b\/\.test\(m\.subject\) \? osAccountMail\(m\) :/.test(src.mail));
  ok("the login email link is a Confirm button, with the address and a copy-the-link fallback", /return "Confirm New Login Email";/.test(src.mail) && /\[\["New login email", m\.to\]\]/.test(src.mail) && /If the button does not work, copy this link into your browser/.test(src.mail));
  ok("the login email change and move mails name A2Z OS (so they wear the frame)", (src.staff.match(/subject: "Confirm your new A2Z OS login email"/g) ?? []).length >= 2);
  ok("client and customer emails never name A2Z OS (they stay plain)", /subject: `Quotation \$\{qt\.doc_number\} from \$\{qt\.issuer_name\}`/.test(src.agent) && /subject: "Set the password of your A2Z account"/.test(src.staff) && /subject: `Your A2Z code: \$\{code\}`/.test(src.index));
  return out;
}

const SRC = Object.fromEntries(Object.entries(F).map(([k, p]) => [k, read(p)]));
const base = checks(SRC);
let failed = 0;
for (const [pass, name] of base) if (!pass) { failed++; console.log(`  ✗ ${name}`); }
const MUT = [
  ["mail", "every email branded, clients included", '/\\bA2Z OS\\b/.test(m.subject) ? osAccountMail(m) :', 'true ? osAccountMail(m) :'],
  ["task", "the task emails draw their own frame again", "const html = osMailHtml({", "const html = String({"],
  ["agent", "a client quotation names A2Z OS", "subject: `Quotation ${qt.doc_number} from ${qt.issuer_name}`", "subject: `A2Z OS Quotation ${qt.doc_number} from ${qt.issuer_name}`"],
  ["mail", "the link is a bare URL again", 'return "Confirm New Login Email";', 'return "Open";'],
];
let caught = 0;
if (!process.env.NOMUT) for (const [k, name, from, to] of MUT) {
  if (!SRC[k].includes(from)) { failed++; console.log(`  ✗ mutation did not apply: ${name}`); continue; }
  if (checks({ ...SRC, [k]: SRC[k].replace(from, to) }).some(([p]) => !p)) caught++; else { failed++; console.log(`  ✗ mutation not caught: ${name}`); }
}
if (failed) { console.log(`os-mail: ${failed} failed`); process.exit(1); }
console.log(`os-mail: ${base.length} checks passed${process.env.NOMUT ? "" : ` (${caught} mutations caught)`} - task emails and staff account emails share one A2Z OS frame; client and customer emails stay plain`);

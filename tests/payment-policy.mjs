#!/usr/bin/env node
/* v1.332.0 - THE PAYMENT & NO REFUND POLICY ON THE PAPER (the CEO, 17-11-2026:
   "Include the approved Payment & No Refund Policy in both invoice templates
   ... above the Payment & Signature section ... in invoice previews, PDF
   downloads, printed documents and shared invoices ... Apply the same policy
   to the relevant quotation acceptance terms before payment ... Both
   companies must use the same approved policy wording").

   What this holds, in the source:
     P1  the wording is the approved text, word for word, in ONE constant
     P2  the HTML template (preview, print, the shared link) draws it inside
         the closing block, ABOVE the PAYMENT / COMMITMENT ORDER heading, on an
         invoice and a quotation - never on a delivery order
     P3  the PDF draws the same constant above its closing block, for the same
         documents; the quotation's clause names the policy in both
     P4  the online acceptance shows it above the tick box, and the box says it
     P5  one wording for both companies: no issuer branch around it; the
         letterhead, bank and signatures still come from resolveIssuer
     P6  the one-page budget makes room for it (quotation and invoice only)
     P7  words only: no amount, status or calculation reads it
   Each rule is proven to catch its own breakage (the mutation pass).

     node tests/payment-policy.mjs     (NOMUT=1 skips the mutation pass) */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const FILES = { tpl: "lib/doc-template.ts", pdf: "lib/doc-pdf.ts", acc: "components/public/doc-accept.tsx" };
const APPROVED = {
  title: "PAYMENT & NO REFUND POLICY",
  p1: "Upon receipt and confirmation of payment, the Company will commence or continue the agreed services according to the approved project scope and timeline.",
  p2: "All payments are non-refundable once work has commenced, except where required by applicable law. Any changes to the agreed scope or timeline must be mutually agreed upon in writing.",
};

function checks(src) {
  const res = [];
  const ok = (name, cond, detail = "") => res.push([name, Boolean(cond), detail]);
  const { tpl, pdf, acc } = src;
  const pol = tpl.slice(tpl.indexOf("export const PAYMENT_POLICY"), tpl.indexOf("} as const;", tpl.indexOf("export const PAYMENT_POLICY")));
  /* P1 */
  ok("P1 the approved wording, word for word, in one constant", pol.includes(`title: "${APPROVED.title}"`) && pol.includes(`"${APPROVED.p1}"`) && pol.includes(`"${APPROVED.p2}"`) && (pol.match(/^\s+"/gm) ?? []).length === 2);
  ok("P1 the documents that carry it: the quotation and the invoice", /export const policyApplies = \(docType: string\) => docType === "INV" \|\| docType === "QT";/.test(tpl));
  /* P2 */
  const inv = tpl.slice(tpl.indexOf("  if (isINV) {\n    bottom ="), tpl.indexOf("  } else if (isDO) {\n    bottom ="));
  const qt = tpl.slice(tpl.indexOf("  } else {\n    bottom = `<div class=\"accept\">"), tpl.indexOf("  let ladder ="));
  const dor = tpl.slice(tpl.indexOf("  } else if (isDO) {\n    bottom ="), tpl.indexOf("  } else {\n    bottom = `<div class=\"accept\">"));
  ok("P2 the HTML builds the block from the constant, only where it applies", /const policy = policyApplies\(doc\.doc_type\)\s*\? `<div class="policy" data-policy="payment-no-refund"><p class="pt">\$\{esc\(PAYMENT_POLICY\.title\)\}<\/p>\$\{PAYMENT_POLICY\.paragraphs\.map/.test(tpl));
  ok("P2 invoice: the policy sits ABOVE the PAYMENT heading, inside the closing block", inv.indexOf("${policy}") > 0 && inv.indexOf("${policy}") < inv.indexOf('<div class="hdr">PAYMENT</div>'));
  ok("P2 quotation: the policy sits ABOVE the COMMITMENT ORDER CONFIRMATION heading", qt.indexOf("${policy}") > 0 && qt.indexOf("${policy}") < qt.indexOf('<div class="hdr">COMMITMENT ORDER CONFIRMATION</div>'));
  ok("P2 never on a delivery order", !dor.includes("${policy}"));
  ok("P2 compact, in the paper's own tint and gold rule (the DOC palette)", /\.policy \{ background: \$\{DOC\.tint\}; border-left: 3px solid \$\{DOC\.gold\};/.test(tpl));
  /* P3 */
  ok("P3 the PDF draws the same constant above its closing block, for the same documents",
    /import \{[^}]*PAYMENT_POLICY, policyApplies[^}]*\} from "@\/lib\/doc-template";/.test(pdf) && /if \(policyApplies\(doc\.doc_type\)\) \{/.test(pdf)
    && /const pt = closeTop - ph - 4;/.test(pdf) && /c\.text\(PAYMENT_POLICY\.title,/.test(pdf) && /for \(const t of PAYMENT_POLICY\.paragraphs\) py = c\.wrap\(t,/.test(pdf)
    && pdf.indexOf("if (policyApplies(doc.doc_type)) {") < pdf.indexOf('const hdr = isINV ? "PAYMENT"'));
  ok("P3 the quotation's acceptance clause names the policy, on the paper and in the PDF",
    /subject to the terms above,\s*including the Payment &amp; No Refund Policy\./.test(tpl) && /subject to the terms above, including the Payment & No Refund Policy\."/.test(pdf));
  /* P4 */
  ok("P4 the online acceptance shows the policy above the tick box, and the box accepts it",
    /import \{ PAYMENT_POLICY \} from "@\/lib\/doc-template";/.test(acc) && acc.indexOf('data-testid="accept-policy"') > 0 && acc.indexOf('data-testid="accept-policy"') < acc.indexOf('type="checkbox"')
    && /on behalf of my company, including the Payment &amp; No Refund Policy\./.test(acc));
  /* P5 */
  ok("P5 one wording for both companies: no issuer test near the policy; the company identity stays resolveIssuer's",
    !/issuer[^\n]{0,80}PAYMENT_POLICY|PAYMENT_POLICY[^\n]{0,80}issuer/.test(tpl + pdf) && /const issuer = resolveIssuer\(doc\.issuer_code\);/.test(tpl)
    && /Payment by bank transfer to <strong>\$\{esc\(issuer\.bank\)\}<\/strong> \(\$\{esc\(issuer\.bankHolder\)\}\)/.test(tpl));
  /* P6 */
  ok("P6 the one-page budget makes room for it, on the quotation and the invoice only",
    /- notesMm - \(policyApplies\(docType\) \? POLICY_MM : 0\)\);/.test(tpl) && /export const POLICY_MM = 18;/.test(tpl));
  /* P7 */
  ok("P7 words only: nothing that counts money reads the policy",
    !/(total_cents|payment_status|rm\(|money\()[^\n]*(PAYMENT_POLICY|policy\b)/.test(tpl + pdf));
  return res;
}

const base = Object.fromEntries(Object.entries(FILES).map(([k, p]) => [k, read(p)]));
const res = checks(base);
let failed = res.filter(([, c]) => !c);
for (const [n, c, d] of res) if (!c) console.log(`  ✗ ${n}${d ? `  [${d}]` : ""}`);

const MUT = [
  ["a word changed", "tpl", "non-refundable once work has commenced", "non-refundable once payment is made"],
  ["a paragraph dropped", "tpl", `    "${APPROVED.p2}",\n`, ""],
  ["the policy under the PAYMENT heading", "tpl", "      ${policy}\n      <div class=\"hdr\">PAYMENT</div>", "      <div class=\"hdr\">PAYMENT</div>\n      ${policy}"],
  ["the quotation loses it", "tpl", "      ${policy}\n      <div class=\"hdr\">COMMITMENT ORDER CONFIRMATION</div>", "      <div class=\"hdr\">COMMITMENT ORDER CONFIRMATION</div>"],
  ["on a delivery order too", "tpl", "export const policyApplies = (docType: string) => docType === \"INV\" || docType === \"QT\";", "export const policyApplies = (_docType: string) => true;"],
  ["the PDF forgets it", "pdf", "  if (policyApplies(doc.doc_type)) {", "  if (false) {"],
  ["the online acceptance without it", "acc", 'data-testid="accept-policy"', 'data-testid="accept-note"'],
  ["no room on the page", "tpl", " - (policyApplies(docType) ? POLICY_MM : 0));", ");"],
  ["one company gets other words", "tpl", "  const policy = policyApplies(doc.doc_type)", "  const policy = issuer.code === \"a2z\" && policyApplies(doc.doc_type)"],
];
let caught = 0;
for (const [name, file, from, to] of (process.env.NOMUT === "1" ? [] : MUT)) {
  if (!base[file].includes(from)) { console.log(`  ✗ mutation anchor missing: ${name}`); failed = [...failed, [name]]; continue; }
  const r = checks({ ...base, [file]: base[file].replace(from, to) });
  if (r.some(([, c]) => !c)) caught++;
  else { console.log(`  ✗ mutation NOT caught: ${name}`); failed = [...failed, [name]]; }
}
if (failed.length) { console.log(`\npayment-policy: ${failed.length} failed`); process.exit(1); }
console.log(`payment-policy: ${res.length} checks passed (${caught} mutations caught)`);

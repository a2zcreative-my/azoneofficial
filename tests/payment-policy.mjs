#!/usr/bin/env node
/* v1.402.0 - THE QUOTATION AND INVOICE POLICIES, SEPARATED (the CEO, 21-11-2026:
   "Quotation: QUOTATION VALIDITY POLICY ... valid for fourteen (14) calendar days
   ... Invoice: Payment & Refund Policy ... Keep the existing PDF design").
   Replaces the v1.332.0 guard (one Payment & No Refund Policy on both).

   It RENDERS the documents - the HTML paper (preview, print, the shared link) and
   the PDF content stream - instead of reading the source, so a passing run means
   the words really print:
     D1  the approved wording, word for word (QT validity, INV payment & refund)
     D2  a NEW quotation (policy_version 2) prints the validity policy and never
         any refund or payment-commencement words; its clause names it
     D3  a NEW invoice prints the Payment & Refund Policy above PAYMENT
     D4  a delivery order prints no policy at all
     D5  a document issued BEFORE (policy_version NULL) keeps the Payment & No
         Refund Policy it was issued - and accepted - with (decision 1)
     D6  a quotation past its validity date says EXPIRED; an undated one, an
         in-date one and an invoice never do
     D7  an invoice billed as a stage of a quotation prints "Payment stage"
     D8  the online acceptance draws the policy of ITS quotation
     D9  the one-page budget holds room for the longest block (22mm)
   Each rule is proven to catch its own breakage (the mutation pass).

     node tests/payment-policy.mjs     (NOMUT=1 skips the mutation pass) */
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const APPROVED = {
  qt: "This quotation is valid for fourteen (14) calendar days from the date of issuance. Any acceptance after the expiry date will be subject to price, scope and availability confirmation by A2Z Creative Marketing. Any changes to the quoted services may require a revised quotation.",
  inv1: "Payment must be made according to the amount, due date and payment schedule stated in this invoice. Work will commence or continue upon confirmation of the required payment, subject to the agreed project scope and timeline.",
  inv2: "Payments for services already commenced may be non-refundable, subject to the agreed service terms and applicable law. Any changes to the project scope or payment arrangements must be mutually agreed upon in writing.",
  legacy: "All payments are non-refundable once work has commenced, except where required by applicable law.",
};
const dir = mkdtempSync(join(tmpdir(), "policy-"));
let n = 0;
async function load(srcTpl) {
  const tplPath = join(dir, `tpl${++n}.ts`);
  writeFileSync(tplPath, srcTpl);
  const entry = join(dir, `entry${n}.ts`);
  writeFileSync(entry, `export * from ${JSON.stringify(tplPath)};\nexport { drawDoc } from "@/lib/doc-pdf";\n`);
  const out = join(dir, `b${n}.mjs`);
  /* the PDF imports the template through "@/lib/doc-template": point it at the (possibly mutated) copy */
  execSync(`npx esbuild "${entry}" --bundle --format=esm --platform=node --alias:@/lib/doc-template="${tplPath}" --alias:@=${JSON.stringify(root)} --outfile="${out}" --log-level=error`, { cwd: root, stdio: "inherit" });
  return import(pathToFileURL(out).href);
}

const day = (off) => new Date(Date.now() + 8 * 3600e3 + off * 864e5).toISOString().slice(0, 10);
const doc = (over) => ({ id: 7, doc_number: "QT-0007", doc_type: "QT", issuer_code: "a2z", company: "Acme Sdn Bhd", contact_person: "Aina",
  items: JSON.stringify([{ name: "Brand video", qty: 1, unit_cents: 250000 }]), total_cents: 250000, created_at: `${day(-3)} 10:00:00`,
  valid_until: day(11), revision: 0, payment_status: null, reference: null, ...over });
/* the PDF stream escapes "(" ")" "\\"; read its strings back as one text */
const pdfText = (s) => [...s.matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)].map((x) => x[1].replace(/\\(.)/g, "$1")).join(" ");
const htmlText = (s) => s.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const norm = (s) => s.replace(/\s+/g, " ");

function checks(m, acc, tpl) {
  const res = [];
  const ok = (name, cond, detail = "") => res.push([name, Boolean(cond), detail]);
  const both = (d) => { const h = htmlText(m.buildDocHtml(d, false)); const p = norm(pdfText(m.drawDoc(d, false))); return { h, p, all: `${h}\n${p}` }; };
  const has = (r, t) => r.h.includes(t) && r.p.replace(/\s+/g, "").includes(t.replace(/\s+/g, ""));
  /* D1 */
  ok("D1 the approved wording, word for word", m.QUOTATION_VALIDITY_POLICY.paragraphs.join("|") === APPROVED.qt && m.QUOTATION_VALIDITY_POLICY.title === "QUOTATION VALIDITY POLICY"
    && m.INVOICE_PAYMENT_POLICY.paragraphs.join("|") === `${APPROVED.inv1}|${APPROVED.inv2}` && m.INVOICE_PAYMENT_POLICY.title === "PAYMENT & REFUND POLICY" && m.QUOTE_VALID_DAYS === 14);
  /* D2 */
  const qt = both(doc({ policy_version: 2 }));
  ok("D2 a new quotation prints the validity policy (HTML and PDF)", has(qt, "QUOTATION VALIDITY POLICY") && has(qt, APPROVED.qt));
  ok("D2 ... and never refund or payment-commencement words", !/refund/i.test(qt.all) && !qt.all.includes(APPROVED.inv1));
  ok("D2 its acceptance clause names the Quotation Validity Policy", has(qt, "including the Quotation Validity Policy."));
  const dmyOf = (iso) => iso.split("-").reverse().join("-");
  ok("D2 the header shows the actual Valid Until date (HTML and PDF)", qt.h.includes(`Valid until ${dmyOf(day(11))}`) && qt.p.includes(dmyOf(day(11))));
  /* D3 */
  const inv = both(doc({ doc_type: "INV", doc_number: "INV-0007", valid_until: null, policy_version: 2 }));
  ok("D3 a new invoice prints the Payment & Refund Policy", has(inv, "PAYMENT & REFUND POLICY") && has(inv, APPROVED.inv1) && has(inv, APPROVED.inv2));
  ok("D3 ... never the validity policy, and above the PAYMENT heading", !inv.all.includes("VALIDITY") && inv.h.indexOf("PAYMENT & REFUND POLICY") < inv.h.lastIndexOf("PAYMENT "));
  /* D4 */
  const dor = both(doc({ doc_type: "DO", doc_number: "DO-0007", valid_until: null, policy_version: 2 }));
  ok("D4 a delivery order prints no policy", !/POLICY/.test(dor.all));
  /* D5 */
  const oldQt = both(doc({ policy_version: null }));
  const oldInv = both(doc({ doc_type: "INV", doc_number: "INV-0001", valid_until: null, policy_version: null }));
  ok("D5 an older quotation keeps the Payment & No Refund Policy it was issued with", has(oldQt, "PAYMENT & NO REFUND POLICY") && has(oldQt, APPROVED.legacy) && !oldQt.all.includes("VALIDITY POLICY") && has(oldQt, "including the Payment & No Refund Policy."));
  ok("D5 an older invoice keeps it too", has(oldInv, "PAYMENT & NO REFUND POLICY") && !oldInv.all.includes("PAYMENT & REFUND POLICY"));
  /* D6 */
  const exp = both(doc({ policy_version: 2, valid_until: day(-1) }));
  const undated = both(doc({ policy_version: null, valid_until: null }));
  const invPast = both(doc({ doc_type: "INV", doc_number: "INV-0002", valid_until: day(-5), policy_version: 2 }));
  ok("D6 a quotation past its date says EXPIRED (HTML and PDF)", /data-expired/.test(m.buildDocHtml(doc({ policy_version: 2, valid_until: day(-1) }), false)) && /\bEXPIRED\b/.test(exp.p));
  ok("D6 an in-date, an undated quotation and an invoice never do", !/\bEXPIRED\b/.test(qt.all) && !/\bEXPIRED\b/.test(undated.all) && !/\bEXPIRED\b/.test(invPast.all) && !/\bEXPIRED\b/.test(oldQt.all));
  /* D7 */
  const stage = both(doc({ doc_type: "INV", doc_number: "INV-0003", valid_until: null, policy_version: 2, reference: "Deposit 50% of QT-0007" }));
  ok("D7 a stage invoice prints its payment stage", has(stage, "Payment stage:") && has(stage, "Deposit 50% of QT-0007") && !inv.all.includes("Payment stage:"));
  /* D8 */
  ok("D8 the online acceptance draws the policy of its quotation", /const pol = policyFor\(\{ doc_type: "QT", policy_version: policyVersion \}\)!;/.test(acc)
    && acc.indexOf('data-testid="accept-policy"') > 0 && acc.indexOf('data-testid="accept-policy"') < acc.indexOf('type="checkbox"') && /including the \{pol\.name\}\./.test(acc)
    && m.policyFor({ doc_type: "QT", policy_version: 2 }).key === "quotation-validity" && m.policyFor({ doc_type: "QT", policy_version: null }).key === "payment-no-refund");
  /* D9 */
  ok("D9 the one-page budget holds room for the longest block", m.POLICY_MM === 22 && /- notesMm - \(policyApplies\(docType\) \? POLICY_MM : 0\)\);/.test(tpl));
  return res;
}

const base = { tpl: read("lib/doc-template.ts"), acc: read("components/public/doc-accept.tsx") };
const res = checks(await load(base.tpl), base.acc, base.tpl);
let failed = res.filter(([, c]) => !c);
for (const [nm, c, d] of res) if (!c) console.log(`  ✗ ${nm}${d ? `  [${d}]` : ""}`);

const MUT = [
  ["a word changed in the validity policy", "tpl", "fourteen (14) calendar days", "thirty (30) calendar days"],
  ["the invoice loses its second paragraph", "tpl", `    "${APPROVED.inv2}",\n`, ""],
  ["the quotation gets the refund policy", "tpl", `      ? { key: "quotation-validity", ...QUOTATION_VALIDITY_POLICY, name: "Quotation Validity Policy" }`, `      ? { key: "payment-refund", ...INVOICE_PAYMENT_POLICY, name: "Payment & Refund Policy" }`],
  ["old documents get the new words", "tpl", "if (Number(doc.policy_version ?? 0) >= POLICY_VERSION) {", "if (true) {"],
  ["a delivery order gets a policy", "tpl", `  if (doc.doc_type !== "QT" && doc.doc_type !== "INV") return null;\n`, ""],
  ["EXPIRED never shown", "tpl", "validUntil.slice(0, 10) < today", "validUntil.slice(0, 10) < \"0000-00-00\""],
  ["the stage line dropped", "tpl", "${stage ? `<p class=\"body stage\" data-stage>", "${false ? `<p class=\"body stage\" data-stage>"],
  ["the acceptance always shows the old words", "acc", "policy_version: policyVersion })!;", "policy_version: null })!;"],
  ["no room on the page", "tpl", "export const POLICY_MM = 22;", "export const POLICY_MM = 18;"],
];
let caught = 0;
for (const [name, file, from, to] of (process.env.NOMUT === "1" ? [] : MUT)) {
  if (!base[file].includes(from)) { console.log(`  ✗ mutation anchor missing: ${name}`); failed = [...failed, [name]]; continue; }
  const mut = { ...base, [file]: base[file].replace(from, to) };
  const r = checks(file === "tpl" ? await load(mut.tpl) : await load(base.tpl), mut.acc, mut.tpl);
  if (r.some(([, c]) => !c)) caught++;
  else { console.log(`  ✗ mutation NOT caught: ${name}`); failed = [...failed, [name]]; }
}
if (failed.length) { console.log(`\npayment-policy: ${failed.length} failed`); process.exit(1); }
console.log(`payment-policy: ${res.length} checks passed (${caught} mutations caught)`);

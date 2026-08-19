/* v1.28.0 — renders the REAL document code (lib/doc-template.ts + lib/issuers.ts,
   imported directly, not copies) and proves the per-document issuer rule:

     issuer_code NULL/absent  -> AZ ONE OFFICIAL letterhead, AZ ONE bank
     issuer_code 'a2z'        -> A2Z CREATIVE MARKETING letterhead, A2Z bank

   and — the part that matters in court — ZERO cross-contamination: a legacy
   invoice must not contain one byte of A2Z identity, and an A2Z invoice must
   not name AZ ONE's bank account.

   Run: node --experimental-strip-types tests/doc-issuer-render.mjs
   (tsconfig path aliases don't exist under strip-types, so this test reads
   the file and rewrites "@/lib/..." imports to relative before importing.) */
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

let failed = 0;
const ok = (label, cond, detail = "") => {
  if (cond) console.log(`ok   ${label}`);
  else { console.log(`FAIL ${label}${detail ? ` — ${detail}` : ""}`); failed++; }
};

// Stage the two modules with the alias import rewritten (strip-types cannot
// resolve "@/lib/issuers"), keeping the SOURCE text otherwise byte-identical.
const dir = mkdtempSync(join(tmpdir(), "issuer-render-"));
// buildDocHtml touches location.origin for the signature <img> — stub it.
globalThis.location = { origin: "https://azoneofficial.com" };
writeFileSync(join(dir, "issuers.ts"), readFileSync("lib/issuers.ts", "utf8"));
writeFileSync(join(dir, "names.ts"), readFileSync("lib/names.ts", "utf8"));
writeFileSync(
  join(dir, "doc-template.ts"),
  readFileSync("lib/doc-template.ts", "utf8").replace(/from "@\/lib\/(\w[\w-]*)"/g, 'from "./$1.ts"'),
);
const { buildDocHtml } = await import(pathToFileURL(join(dir, "doc-template.ts")).href);
const { AZ_ONE, A2Z_CREATIVE, DOCUMENT_ISSUER, resolveIssuer } = await import(
  pathToFileURL(join(dir, "issuers.ts")).href
);

// ---- the registry itself ----
ok("DOCUMENT_ISSUER is A2Z", DOCUMENT_ISSUER.name === "A2Z CREATIVE MARKETING" && DOCUMENT_ISSUER.ssm === "202603003468");
ok("A2Z bank is the CEO-supplied account", DOCUMENT_ISSUER.bank === "MAYBANK 5511 0086 5300" && DOCUMENT_ISSUER.bankHolder === "A2Z CREATIVE MARKETING");
ok("resolveIssuer(null) -> AZ ONE (legacy)", resolveIssuer(null) === AZ_ONE && resolveIssuer(undefined) === AZ_ONE);
ok("resolveIssuer('a2z') -> A2Z", resolveIssuer("a2z") === A2Z_CREATIVE);
ok("resolveIssuer(unknown) fails toward history", resolveIssuer("garbage") === AZ_ONE);

// ---- render both variants of the SAME invoice ----
const baseDoc = {
  doc_type: "INV", doc_number: "INV-AZOO190826-1", company: "ELFIA",
  contact_person: "Client Contact", items: JSON.stringify([{ name: "Live hosting", qty: 1, unit_price_cents: 100000 }]),
  discount_cents: 0, tax_percent: 0, total_cents: 100000, created_at: "2026-08-19 04:00:00",
  payment_status: "unpaid", signer_role: null, signer_name: null, kind: "service",
};
const legacyHtml = buildDocHtml({ ...baseDoc }, false);
const a2zHtml = buildDocHtml({ ...baseDoc, issuer_code: "a2z" }, false);

// legacy = AZ ONE everywhere
ok("legacy: AZ ONE letterhead", legacyHtml.includes("AZ ONE OFFICIAL"));
ok("legacy: AZ ONE registration", legacyHtml.includes("SSM 202603168673 (JM1046169-H)"));
ok("legacy: AZ ONE bank account", legacyHtml.includes("MAYBANK 5516 2328 7032"));
ok("legacy: SST note names AZ ONE", legacyHtml.includes("AZ ONE OFFICIAL is not"));
// legacy contamination check — no A2Z identity anywhere
ok("legacy: ZERO A2Z name", !legacyHtml.includes("A2Z CREATIVE MARKETING"));
ok("legacy: ZERO A2Z SSM", !legacyHtml.includes("202603003468"));
ok("legacy: ZERO A2Z bank", !legacyHtml.includes("5511 0086 5300"));

// a2z = A2Z everywhere
ok("a2z: A2Z letterhead", a2zHtml.includes("A2Z CREATIVE MARKETING"));
ok("a2z: A2Z registration", a2zHtml.includes("SSM 202603003468 (CA0414729-A)"));
ok("a2z: A2Z bank account", a2zHtml.includes("MAYBANK 5511 0086 5300"));
ok("a2z: SST note names A2Z", a2zHtml.includes("A2Z CREATIVE MARKETING is not"));
// a2z contamination check — no AZ ONE identity anywhere
ok("a2z: ZERO AZ ONE name", !a2zHtml.includes("AZ ONE OFFICIAL"));
ok("a2z: ZERO AZ ONE SSM", !a2zHtml.includes("202603168673"));
ok("a2z: ZERO AZ ONE bank", !a2zHtml.includes("5516 2328 7032"));

// the customer-facing fields are identical in both — only the issuer moved
for (const probe of ["INV-AZOO190826-1", "ELFIA", "Live hosting"]) {
  ok(`both variants keep customer field "${probe}"`, legacyHtml.includes(probe) && a2zHtml.includes(probe));
}

if (failed) { console.log(`\nFAIL — ${failed} check(s) failed`); process.exit(1); }
console.log("\nPASS — legacy documents stay AZ ONE OFFICIAL, new documents are A2Z, no cross-contamination");

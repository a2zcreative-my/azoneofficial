/* v1.27.0 tripwire, DELIBERATELY UPDATED v1.28.0 — the issuer switch to A2Z.

   19-08-2026, CEO decisions on record: "A2Z invoices, A2Z employs"; A2Z
   CREATIVE MARKETING registered address supplied (34-02, Jalan Setia Tropika
   1/1 — same office); Maybank account 5511 0086 5300 held in A2Z's name;
   A2Z is NOT SST-registered. Every condition the v1.27.0 STOP checklist
   demanded was met before this test was changed.

   The contract this guard now enforces:
   1) no document generator in lib/ may reference SITE_CONFIG — marketing
      identity never leaks into a legal document;
   2) DOCUMENT_ISSUER (stamped onto every NEW document) is A2Z CREATIVE
      MARKETING with the exact CEO-supplied bank account — if the account or
      name drift, invoices carry a payee the bank rejects;
   3) AZ_ONE stays complete and byte-stable — every document issued before
      the switch renders under AZ ONE OFFICIAL's letterhead and bank account
      FOREVER (issuer_code NULL = legacy), so its entry may never be edited
      or removed;
   4) resolveIssuer() keeps the legacy mapping: null/undefined -> AZ_ONE,
      'a2z' -> A2Z_CREATIVE — fail toward the historical issuer.
   Run from the repo root: node tests/document-issuer-guard.mjs */
import { readFileSync, existsSync } from 'node:fs';

const errors = [];

/* Every file in lib/ that renders a document a customer or an employee
   receives. Add to this list whenever a new generator lands. */
const GENERATORS = [
  'lib/doc-pdf.ts',        // quotation / delivery order / invoice PDF
  'lib/doc-template.ts',   // the HTML twin of doc-pdf
  'lib/payslip-pdf.ts',    // payslips
  'lib/form-pdf.ts',       // HR forms
  'lib/roster-pdf.ts',     // published rosters
  'lib/receipt-print.ts',  // official receipt / credit note
];

/* ---- precondition: the scan must actually have something to scan --------
   A rename or a moved directory must fail loudly, not pass vacuously by
   finding zero SITE_CONFIG references in zero files. */
const scanned = [];
for (const f of GENERATORS) {
  if (!existsSync(f)) {
    errors.push(`precondition: expected document generator ${f} not found — was it renamed or moved? Update GENERATORS in this test (and check the new file for SITE_CONFIG) rather than deleting the entry`);
    continue;
  }
  const src = readFileSync(f, 'utf8');
  if (src.trim().length < 100) {
    errors.push(`precondition: ${f} is suspiciously small (${src.trim().length} bytes) — the scan below would be meaningless`);
    continue;
  }
  scanned.push([f, src]);
}
if (scanned.length !== GENERATORS.length) {
  errors.push(`precondition: scanned ${scanned.length} of ${GENERATORS.length} document generators — a partial scan cannot pass`);
}

/* ---- 1. no marketing identity inside a legal document -------------------
   Comments may name SITE_CONFIG — they explain why it is banned here — so
   comments are blanked out (newlines preserved, line numbers stay true)
   before the scan. Strings and template literals are NOT blanked: the
   receipt's letterhead lives inside a template literal. */
function stripComments(src) {
  let out = '';
  let state = 'code'; // code | line | block | ' | " | `
  for (let i = 0; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (state === 'code') {
      if (c === '/' && n === '/') { state = 'line'; out += '  '; i++; continue; }
      if (c === '/' && n === '*') { state = 'block'; out += '  '; i++; continue; }
      if (c === '"' || c === "'" || c === '`') state = c;
      out += c; continue;
    }
    if (state === 'line') { if (c === '\n') { state = 'code'; out += c; } else out += ' '; continue; }
    if (state === 'block') {
      if (c === '*' && n === '/') { state = 'code'; out += '  '; i++; continue; }
      out += c === '\n' ? c : ' '; continue;
    }
    // inside a string / template literal
    if (c === '\\') { out += c + (src[i + 1] ?? ''); i++; continue; }
    if (c === state) state = 'code';
    out += c;
  }
  return out;
}

for (const [f, src] of scanned) {
  const hits = stripComments(src)
    .split('\n')
    .map((line, i) => [i + 1, line])
    .filter(([, line]) => /SITE_CONFIG/.test(line));
  for (const [n, line] of hits) {
    errors.push(`${f}:${n} references SITE_CONFIG — SITE_CONFIG is the marketing identity (A2Z CREATIVE MARKETING after the migration) and must never appear on a document issued by AZ ONE OFFICIAL. Read the letterhead from DOCUMENT_ISSUER in lib/issuers.ts instead. Line: ${line.trim()}`);
  }
}

/* ---- 2. the issuer of record is still AZ ONE OFFICIAL ------------------- */
const ISSUERS = 'lib/issuers.ts';
if (!existsSync(ISSUERS)) {
  errors.push(`${ISSUERS} is missing — it is the single source of truth for document issuer identity. Do not let the generators fall back to SITE_CONFIG`);
} else {
  const src = readFileSync(ISSUERS, 'utf8');
  const decl = /export\s+const\s+DOCUMENT_ISSUER\s*(?::[^=]+)?=\s*([A-Za-z_$][\w$]*)\s*;/.exec(src);
  if (!decl) {
    errors.push(`${ISSUERS} no longer exports DOCUMENT_ISSUER as a plain alias of a named issuer entry — this guard cannot verify which entity issues documents. Keep it a one-line alias (export const DOCUMENT_ISSUER: Issuer = AZ_ONE;)`);
  } else {
    const entry = decl[1];
    const start = src.search(new RegExp(`export\\s+const\\s+${entry}\\s*(?::[^=]+)?=\\s*\\{`));
    const end = start === -1 ? -1 : src.indexOf('\n};', start);
    if (start === -1 || end === -1) {
      errors.push(`${ISSUERS}: DOCUMENT_ISSUER points at "${entry}", but that entry's object literal could not be located`);
    } else {
      const body = src.slice(start, end);
      if (!/\bssm:\s*"202603003468"/.test(body)) {
        errors.push(`${ISSUERS}: DOCUMENT_ISSUER resolves to "${entry}", whose ssm is NOT A2Z CREATIVE MARKETING's 202603003468.

  STOP. The operating issuer was deliberately switched to A2Z on 19-08-2026 (CEO decision, bank account 5511 0086 5300 supplied). Changing it again is a legal-entity event, not a refactor:
    - confirm whose name the bank account on new invoices is held in;
    - confirm the SST status of the entity you are switching to;
    - existing stamped documents are NOT affected either way (issuer_code decides their letterhead) — do not "fix" history;
    - then update this test deliberately.`);
      }
      if (!/\bname:\s*"A2Z CREATIVE MARKETING"/.test(body)) {
        errors.push(`${ISSUERS}: DOCUMENT_ISSUER entry "${entry}" does not print the name "A2Z CREATIVE MARKETING" — the legal name on a document must be exact and uppercase`);
      }
      if (!/\bbank:\s*"MAYBANK 5511 0086 5300"/.test(body)) {
        errors.push(`${ISSUERS}: DOCUMENT_ISSUER entry "${entry}" does not carry the CEO-supplied A2Z Maybank account "MAYBANK 5511 0086 5300" — a wrong or missing account number on an invoice misdirects customer payments`);
      }
      if (!/\bbankHolder:\s*"A2Z CREATIVE MARKETING"/.test(body)) {
        errors.push(`${ISSUERS}: DOCUMENT_ISSUER's bankHolder must exactly equal "A2Z CREATIVE MARKETING" — payee name and account holder must agree or the bank rejects the transfer`);
      }
      if (!/\bsstRegistered:\s*false/.test(body)) {
        errors.push(`${ISSUERS}: DOCUMENT_ISSUER must carry sstRegistered: false (CEO confirmation 19-08-2026) — flipping this changes a tax statement on every invoice`);
      }
    }
  }

  /* ---- 3. legacy fidelity: AZ_ONE must remain byte-stable ---------------
     Every document issued before the switch renders from this entry forever.
     These are the exact strings printed on documents customers already hold. */
  for (const [re, why] of [
    [/export\s+const\s+AZ_ONE\s*:\s*Issuer\s*=/, 'AZ_ONE must remain a complete Issuer (legacy documents render from it)'],
    [/\bname:\s*"AZ ONE OFFICIAL"/, 'AZ_ONE.name changed — legacy letterheads would change'],
    [/\bssm:\s*"202603168673"/, 'AZ_ONE.ssm changed — legacy registration lines would change'],
    [/\bbank:\s*"MAYBANK 5516 2328 7032"/, 'AZ_ONE.bank changed — the account printed on already-issued invoices must never change'],
    [/\bclaimFormNo:\s*"AZOO-HR-CLM-001"/, 'AZ_ONE claim form control number changed — signed forms reference it'],
    [/\bleaveFormNo:\s*"AZOO-HR-LVE-001"/, 'AZ_ONE leave form control number changed — signed forms reference it'],
  ]) {
    if (!re.test(src)) errors.push(`${ISSUERS}: ${why}`);
  }

  /* ---- 4. the legacy mapping in resolveIssuer ---------------------------- */
  const rvi = /export function resolveIssuer[\s\S]{0,200}?return\s+code\s*===\s*"a2z"\s*\?\s*A2Z_CREATIVE\s*:\s*AZ_ONE\s*;/.test(src);
  if (!rvi) {
    errors.push(`${ISSUERS}: resolveIssuer() no longer maps null/undefined -> AZ_ONE and 'a2z' -> A2Z_CREATIVE. NULL means "issued before the switch" and MUST render AZ ONE OFFICIAL — anything else retroactively rebrands documents customers already hold`);
  }

  /* The receipt is the file that used to read SITE_CONFIG; make sure it is
     still wired to the issuer and did not simply lose its letterhead. */
  const receipt = existsSync('lib/receipt-print.ts') ? readFileSync('lib/receipt-print.ts', 'utf8') : '';
  if (!/resolveIssuer|DOCUMENT_ISSUER/.test(receipt)) {
    errors.push('lib/receipt-print.ts no longer references lib/issuers.ts (resolveIssuer/DOCUMENT_ISSUER) — the receipt/credit-note letterhead must come from the issuer registry');
  }
}

/* ---- 5. v1.30.1 — the consultancy ('azoo') stamping contract ------------ */
{
  const staff = readFileSync('worker/src/staff.ts', 'utf8');
  for (const [re, why] of [
    [/code:\s*"a2z"\s*\|\s*"azoo"\s*=\s*OPERATING_ISSUER_CODE/,
     'stampIssuer lost its entity parameter (default a2z) — the consultancy option cannot stamp'],
    [/const issuerD[\s\S]{0,120}?body\.issuer\s*===\s*"azoo"\s*\?\s*"azoo"\s*:\s*"a2z"/,
     'doc creation no longer honours body.issuer ("azoo" or A2Z default) — the Issued-by selector would silently save everything as A2Z'],
    [/qtIssuer\s*===\s*"azoo"\s*\?\s*"azoo"\s*:\s*"a2z"/,
     'QT→INV conversion no longer inherits the quotation\'s entity — a client with an AZ ONE quote would receive an A2Z invoice and a different bank account'],
    [/invIssuerR\s*=\s*ir\?\.issuer_code\s*===\s*"azoo"/,
     'receipts no longer inherit the invoice\'s entity — a receipt must acknowledge money paid into the account the INVOICE printed'],
    [/invIssuerC\s*=\s*ic\?\.issuer_code\s*===\s*"azoo"/,
     'credit notes no longer inherit the invoice\'s entity'],
  ]) {
    if (!re.test(staff)) errors.push(`worker/src/staff.ts: ${why}`);
  }
  /* HR paperwork is A2Z, always — "A2Z employs". These two calls must stay
     on the default, never grow an entity argument. */
  for (const [call, why] of [
    ['stampIssuer(env, "claims", res?.id)', 'claims stamping changed — HR paper is issued by A2Z, always ("A2Z employs")'],
    ['stampIssuer(env, "leave_requests", res?.id)', 'leave stamping changed — HR paper is issued by A2Z, always ("A2Z employs")'],
  ]) {
    if (!staff.includes(call)) errors.push(`worker/src/staff.ts: ${why}`);
  }
}

if (errors.length) { console.log('FAIL\n - ' + errors.join('\n - ')); process.exit(1); }
console.log(`PASS — ${scanned.length} generators free of SITE_CONFIG; DOCUMENT_ISSUER is A2Z CREATIVE MARKETING (SSM 202603003468, MAYBANK 5511 0086 5300); AZ_ONE legacy entry intact; resolveIssuer maps NULL -> AZ ONE; consultancy 'azoo' stamps and inherits correctly`);

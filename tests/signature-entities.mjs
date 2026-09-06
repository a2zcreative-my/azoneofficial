#!/usr/bin/env node
/* Guard #56 — v1.127.0: a document is signed by the entity that ISSUED it.
 *
 * The CEO, 06-09-2026: *"2 Entity of company which is A2Z Creative Marketing
 * and AZ One Official and both need separated e-signature due to the company
 * stamp on it."*
 *
 * He is describing a live defect, not a feature request. Migration 0073 put
 * issuer_code on all six document tables, and since v1.28.0 every renderer
 * has resolved the letterhead, the registration number, the registered
 * address and the bank account from it — so a re-printed 2026-07 invoice
 * correctly shows AZ ONE OFFICIAL. The signature vault was the one thing that
 * never learned about it: keyed by role alone, five files, one CEO chop for
 * two companies. That invoice printed AZ ONE letterhead over the A2Z stamp —
 * a document that contradicts itself about which legal entity approved it.
 *
 * The second missing dimension is VERSION, and it is the same bug: a key with
 * no dimensions can only hold the current file, so replacing a chop silently
 * changed every document already approved under the old one.
 *
 * WHAT THIS GUARD ASSERTS (properties, not spellings):
 *
 *   1. Every door into the vault takes an ENTITY. There are four — the
 *      role-file route, the claim-scoped route, the leave-scoped route and
 *      the public share-token route in index.ts — and a door that resolves
 *      without an entity is a door that serves the wrong company's stamp.
 *   2. Resolution is TEMPORAL: the newest version uploaded AT OR BEFORE the
 *      document's own date. That is what makes an old document keep the chop
 *      it was signed with, and it is why there is no per-document column.
 *   3. Uploads APPEND. Nothing overwrites an r2_key and nothing deletes a
 *      version, because a document signed under v1 must resolve v1 forever.
 *   4. The legacy flat files serve A2Z ONLY. They were uploaded while A2Z was
 *      the operating issuer, so that is what they are. An AZ ONE document
 *      with no AZ ONE chop shows a BLANK zone — an unsigned document is a
 *      document awaiting ink, which the forms already handle; a document
 *      bearing the other company's stamp is a false statement.
 *   5. The two copies of the resolution rule agree. staff.ts owns the helper;
 *      index.ts restates it because it is the module staff.ts imports from,
 *      so the import would run the wrong way. Two copies is a drift risk, and
 *      this is the check that pays for it.
 *   6. The step-up gates the SIGNATURE, not the click: an approval that
 *      attaches the chop asks for a live code; a rejection, which signs
 *      nothing, does not.
 *
 * Negative-tested by: dropping the entity from the role-file route; making
 * the resolver ignore the document date; letting the legacy fallback answer
 * for azoo; removing the step-up from the claim approval.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(join(root, p), "utf8");
let failed = 0, passed = 0;
const ok = (label, cond, why = "") => { if (cond) passed++; else { failed++; console.log(`  ✗ ${label}${why ? ` — ${why}` : ""}`); } };

const staff = read("worker/src/staff.ts");
const index = read("worker/src/index.ts");
const panel = read("components/admin/signatures-panel.tsx");
const tmpl = read("lib/doc-template.ts");
const pdf = read("lib/doc-pdf.ts");
const mig = read("worker/migrations/0118_signature_vault.sql");

/* ---- 1. every door takes an entity ----------------------------------- */
ok("the role-file route is entity-scoped",
   /\/signature\\\/\(a2z\|azoo\)\\\//.test(staff) || /signature\\\/\(a2z\|azoo\)/.test(staff),
   "without an entity the route serves whichever single file is in the vault");
ok("the upload route is entity-scoped",
   /signatures\\\/\(a2z\|azoo\)\\\//.test(staff));
ok("the claim door resolves from the claim's OWN issuer",
   /resolveSignatureKey\(cl\.issuer_code,/.test(staff));
ok("the leave door resolves from the form's OWN issuer",
   /resolveSignatureKey\(lv\.issuer_code,/.test(staff));
ok("the public share-token door resolves from the document's issuer",
   /sigDoc\.issuer_code === "a2z"/.test(index));
ok("the printed document asks for its own entity's chop",
   /doc\.issuer_code === "a2z"/.test(tmpl) && /signature\/\$\{sigEntity\}\//.test(tmpl));
ok("the saved PDF asks for the same entity as the letterhead it draws",
   /doc\.issuer_code === "a2z"/.test(pdf) && /signature\/\$\{sigEntity\}\//.test(pdf));

/* ---- 2. resolution is temporal --------------------------------------- */
/* The PROPERTY: the query is bounded by the document's date and ordered
   newest-first. Spelled loosely so the column list can move. */
ok("the vault resolves the version current when the document was signed",
   /uploaded_at <= \?3[\s\S]{0,200}ORDER BY uploaded_at DESC/.test(staff),
   "without the upper bound, a chop uploaded today would re-sign last year's documents");
ok("the same bound is in the public door",
   /uploaded_at <= \?3[\s\S]{0,200}ORDER BY uploaded_at DESC/.test(index));
ok("each door passes the document's OWN timestamp, not now()",
   /resolveSignatureKey\(cl\.issuer_code, sigRole, sigAt\)/.test(staff)
   && /resolveSignatureKey\(lv\.issuer_code, lvRole, lvAt\)/.test(staff));
ok("a document older than every upload still gets the earliest chop",
   /ORDER BY uploaded_at ASC, version ASC LIMIT 1/.test(staff),
   "otherwise every pre-vault document loses its signature");

/* ---- 3. uploads append, nothing overwrites --------------------------- */
ok("an upload takes the next version for that entity and role",
   /MAX\(version\)[\s\S]{0,160}WHERE issuer_code = \?1 AND role = \?2/.test(staff));
ok("the object key carries the entity and the version",
   /private\/signatures\/\$\{entity\}\/\$\{role\}-v\$\{version\}\.png/.test(staff));
ok("the worker never updates or deletes a vault row",
   !/UPDATE signature_assets/.test(staff) && !/DELETE FROM signature_assets/.test(staff),
   "a document signed under v1 has to resolve v1 for as long as it exists");
ok("the vault records who uploaded it and the bytes' hash",
   /sha256/.test(staff) && /uploaded_by/.test(staff) && /crypto\.subtle\.digest\("SHA-256"/.test(staff));
ok("one row per entity+role+version, enforced by the database",
   /CREATE UNIQUE INDEX[\s\S]{0,120}\(issuer_code, role, version\)/.test(mig));

/* ---- 4. the legacy fallback is A2Z-only ------------------------------ */
ok("the legacy flat files answer for A2Z and refuse for AZ ONE",
   /if \(entity !== "a2z"\) return null;/.test(staff),
   "an AZ ONE document must show a blank zone, never the other company's stamp");
ok("the public door applies the same limit",
   /if \(!sigKey && sigEntity === "a2z"\)/.test(index));
ok("the admin panel says which chops are missing per entity",
   /A2Z CREATIVE MARKETING/.test(panel) && /AZ ONE OFFICIAL/.test(panel)
   && /Missing/.test(panel));

/* ---- 4b. WHOSE signature is in the cell (v1.130.0) -------------------
   CEO, 06-09-2026, handing over six scans: *"ensure that the signature is
   embedded correctly to the person which is no leaked out of false in use!"*

   The failure this catches is not a missing chop, it is a MISPLACED one. All
   three officers of one entity share one company stamp, so a version number
   and an upload date cannot tell you whose hand is in a row; only the picture
   can. Put the COO's scan in the CEO row and every document afterwards
   carries the wrong signature under the right name, silently.

   So the panel must DRAW the chop that the vault would actually serve, from
   the vault's own route rather than from the file that was uploaded - what is
   on screen has to be what a document would print. */
ok("the panel shows the chop that is in each cell",
   /<Chop\b/.test(panel) && /function Chop\(/.test(panel),
   "a version and a date say an upload happened, not whose signature it was");
ok("the thumbnail comes from the vault's own authenticated route",
   /\/api\/v1\/staff\/signature\/\$\{entity\}\/\$\{role\.replace/.test(panel),
   "drawing the uploaded file instead would show what you MEANT to store, not what is stored");
ok("a new version busts the cache",
   /\?v=\$\{version\}/.test(panel),
   "without it a fresh upload keeps showing the old chop - a stale picture at the one moment it misleads");
ok("the chop opens full size, to hold against the paper",
   /function ChopZoom\(/.test(panel) && /max-h-\[60vh\]/.test(panel));
ok("the signature is drawn on a white plate",
   /bg-white/.test(panel),
   "navy ink on transparency is a dark smudge on a dark card");
ok("the panel says the picture is the thing to check",
   /the handwriting beside it is the only thing that says who signed/.test(panel));
ok("the full-size view asks the question outright",
   /Is this the right person\?/.test(panel));
/* House rule, v1.124.0: a modal locks BODY, never <html>. */
ok("the full-size view locks BODY, not <html>",
   /document\.body\.style\.overflow = "hidden"/.test(panel)
   && !/documentElement\.style\.overflow/.test(panel));
ok("it restores the scroll and closes on Escape",
   /document\.body\.style\.overflow = prev/.test(panel) && /e\.key === "Escape"/.test(panel));

/* ---- 5. the two copies of the rule agree ----------------------------- */
const grab = (src) => {
  const m = src.match(/WHERE issuer_code = \?1 AND role = \?2 AND uploaded_at <= \?3\s*\n?\s*ORDER BY ([^`]+?)LIMIT 1/);
  return m ? m[1].replace(/\s+/g, " ").trim() : null;
};
const a = grab(staff), b = grab(index);
ok("staff.ts and index.ts resolve identically", !!a && a === b, `${a} vs ${b}`);

/* ---- 6. the step-up gates the signature, not the click --------------- */
ok("a claim APPROVAL asks for a live code",
   /if \(action === "approve"\) \{\s*\n\s*const stepUp = await requireFreshTotp/.test(staff));
ok("the final leave approval asks for a live code",
   /willBeFinal[\s\S]{0,120}requireFreshTotp/.test(staff));
ok("only the approval that carries the chop is gated",
   /leaveNextStage\(row\.stage, row\.applicant_role\) === "approved"/.test(staff),
   "gating every stage asks a manager for a code to sign nothing");
ok("the step-up never locks out somebody who cannot produce a code",
   /if \(!row\?\.totp_secret \|\| !row\.totp_enabled\) return null;/.test(staff));
ok("the code is single-use — it goes through the replay guard",
   /totpVerifyOnce\(env, user\.id, row\.totp_secret/.test(staff));
/* The client must not decide WHICH approval is final: the server owns the
   chain, and a second copy of that arithmetic is a second thing to get wrong. */
const shared = read("components/portal/page-shared.tsx");
ok("the portal asks for a code only when the server says so",
   /first\.status !== 401/.test(shared) && /export async function withStepUp/.test(shared));

console.log(`${failed ? "✗" : "✓"} signature-entities: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

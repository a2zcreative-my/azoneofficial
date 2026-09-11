/**
 * ONE QUOTATION, ONE INVOICE; A DESK ITEM LANDS WHERE IT IS DECIDED —
 * guard #76, v1.154.0.
 *
 * The CEO, 11-09-2026, three complaints in one breath:
 *   *"the QT which is already click Invoice should be updated as a sales!
 *   then Quotation should not allowed twice Invoice generate!"*
 *   *"when I click on the OT, it doesnt go to OT section"*
 *   *"when I approve the OT, it doesnt appear the popup box which is
 *   supposed to implement globally"*
 *
 * THE PROPERTIES:
 *   1. A QUOTATION IS INVOICED ONCE. The worker refuses a second conversion
 *      (409 naming the invoice); the list carries which invoice a quotation
 *      became; a converted quotation's row offers no second click and says
 *      "Invoiced"; the "Quotations open" count and list leave it out.
 *   2. "OPEN" IS COMPUTED FROM THE INVOICE SIDE. converted_from lives on the
 *      INVOICE, so the old "QT WHERE converted_from IS NULL" was every
 *      quotation ever written. The count asks NOT EXISTS (an invoice that
 *      came from this quotation).
 *   3. A DESK ITEM LANDS ON ITS CARD. Overtime, forgotten punches and claims
 *      carry an anchor; the target elements exist; the reveal waits for the
 *      lazily-loaded panel instead of assuming it is there.
 *   4. AN OT APPROVAL ASKS FIRST, with the same dialog every other decision
 *      uses, and still toasts after. The Dashboard modal says the queue is
 *      clear instead of showing an empty box.
 *
 * Negative-tested by: dropping the `already` check in convert (1); putting
 * the count back to converted_from IS NULL (2); removing the ot anchor id
 * (3); removing the approve confirm (4).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(root, p), "utf8");

let passed = 0, failed = 0;
const ok = (label, cond, why = "") => {
  if (cond) passed += 1;
  else { failed += 1; console.log(`  ✗ ${label}${why ? ` — ${why}` : ""}`); }
};

const staff = read("worker/src/staff.ts");
const sales = read("components/portal/sales.tsx");
const dash = read("components/portal/dashboard.tsx");
const desk = read("components/portal/one-desk.tsx");
const shared = read("components/portal/page-shared.tsx");
const live = read("components/portal/live-cards.tsx");
const rp = read("components/portal/role-panels.tsx");

/* ---- 1 + 2. one quotation, one invoice ---- */
{
  const conv = staff.slice(staff.indexOf("const docConv = path.match"), staff.indexOf("const docConv = path.match") + 2500);
  ok("convert refuses a quotation that already has an invoice", /SELECT doc_number FROM sales_documents WHERE converted_from = \?1 AND doc_type = 'INV'/.test(conv) && /if \(already\) return err\("already_invoiced"/.test(conv));
  ok("and refuses BEFORE a number is minted or stock moves", conv.indexOf("if (already) return err") < conv.indexOf('await docNumber(env, "INV")') && conv.indexOf("if (already) return err") < conv.indexOf("deductForInvoice"));
  const docs = staff.slice(staff.indexOf('if (path === "/docs" && method === "GET")'), staff.indexOf('if (path === "/docs" && method === "GET")') + 1800);
  ok("the list says which invoice a quotation became", /i\.converted_from = d\.id AND i\.doc_type = 'INV'[\s\S]*?AS invoiced_as/.test(docs));
  ok("the open count is computed from the invoice side", /doc_type = 'QT'\s*AND NOT EXISTS \(SELECT 1 FROM sales_documents i WHERE i\.converted_from = q\.id AND i\.doc_type = 'INV'\)/.test(staff) && !/doc_type = 'QT' AND converted_from IS NULL/.test(staff));
  ok("a converted quotation's row says Invoiced and offers no second click", /d\.doc_type === "QT" && d\.invoiced_as && \([\s\S]*?\{L\("Invoiced", "Diinvois"\)\} · \{d\.invoiced_as\}/.test(sales) && /d\.doc_type === "QT" && !d\.invoiced_as && canInvoice && \(/.test(sales));
  ok("the Quotations open list leaves converted quotations out", /!\(kind === "QT" && d\.invoiced_as\)/.test(dash));
}

/* ---- 3. a desk item lands on its card ---- */
{
  ok("the desk carries anchors for overtime, punches and claims", /ot: "ot-approvals"/.test(desk) && /punches: "pending-punches"/.test(desk) && /claims: "claims-pending"/.test(desk));
  ok("pressing an item switches the tab AND reveals the card", /go\(i\.tab\); revealAnchor\(ANCHOR\[i\.bucket\]\)/.test(desk));
  ok("the reveal waits for the lazily-loaded panel", /export function revealAnchor/.test(shared) && /tries\+\+ < 40/.test(shared) && /scrollIntoView/.test(shared));
  ok("the overtime card carries its anchor", /id="ot-approvals"/.test(live));
  ok("the forgotten-punches block carries its anchor", /id="pending-punches"/.test(rp));
  ok("the claims pending card carries its anchor", /id="claims-pending"/.test(rp));
}

/* ---- 4. approve asks first; the modal says when it is clear ---- */
{
  const decide = live.slice(live.indexOf("const decide = async (p: Pend"), live.indexOf("const decide = async (p: Pend") + 3000);
  ok("approving overtime asks first", /decision === "approved" &&\s*!\(await otConfirm\(\{\s*title: L\("Approve this overtime\?"/.test(decide));
  ok("and still toasts after", /showOtToast\(\s*decision === "approved" \? L\("OT approved"/.test(decide));
  ok("the dialog says it is a payroll figure", /Approved overtime goes straight to the payroll/.test(decide));
  ok("the modal says the queue is clear instead of an empty box", /inModal && \([\s\S]*?Nothing pending — every overtime stretch has been decided\./.test(live));
}

console.log(failed === 0
  ? `qt-once: ${passed} checks passed.`
  : `\n${failed} qt-once check(s) failed.`);
process.exitCode = failed === 0 ? 0 : 1;

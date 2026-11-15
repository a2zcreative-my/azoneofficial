/**
 * WHICH CLAIMS A PERSON READS - v1.205.0.
 *
 * Lifted, unchanged, from the GET /claims route in staff.ts so that the
 * search box (worker/src/search.ts) finds exactly the claims that list shows
 * the same person. Two copies of a read rule is how a search leaks a claim
 * its reader could not open; one copy, two callers.
 *
 * Deciders (claims_decide) read everyone's claims. Otherwise:
 *  - hr_admin: own, the staff chain's, and every APPROVED claim (v1.4.121:
 *    read-only, for printing claim forms and payout proofs);
 *  - coo and admin: own and the staff chain's;
 *  - cco: own and HR's;
 *  - everyone else: their own.
 * v1.4.174: the PAYEE always reads the claim raised in their name
 * (`withPayee`), so the person being paid can follow pending -> approved ->
 * paid even when someone else submitted it. withPayee = false is the
 * pre-0051 fallback without the column.
 *
 * The clause expects the claim as `c` and the claimant as `u`; `me` is the
 * placeholder bound to the reader's user id.
 */

export const CLAIM_STAFF_CHAIN = "('marketing','sales_marketing','editor','live_host')";

/* v1.310.0 (Claims 4.0) - who reads every claim: the decider (the CEO) and,
   READ ONLY, the Super Admin - who no longer decides or pays (C-2) but keeps
   the view it always had. */
export const claimReadsAll = (role: string, decides: boolean): boolean => decides || role === "super_admin";
/* v1.310.0 (C-1) - the CEO's own claims (raised by him or paid to him) are
   the COO's to decide, so the COO reads them */
const CEO_OWN = (withPayee: boolean) => ` OR u.role = 'ceo'${withPayee ? ` OR c.payee_user_id IN (SELECT id FROM users WHERE role = 'ceo')` : ""}`;

export function claimScope(role: string, all: boolean, withPayee: boolean, me = "?1"): string {
  const P = withPayee ? ` OR c.payee_user_id = ${me}` : "";
  return all ? ""
    : role === "hr_admin" ? ` WHERE (c.user_id = ${me} OR u.role IN ${CLAIM_STAFF_CHAIN} OR c.status = 'approved'${P})`
    : role === "coo" ? ` WHERE (c.user_id = ${me} OR u.role IN ${CLAIM_STAFF_CHAIN}${CEO_OWN(withPayee)}${P})`
    : role === "admin" ? ` WHERE (c.user_id = ${me} OR u.role IN ${CLAIM_STAFF_CHAIN}${P})`
      : role === "cco" ? ` WHERE (c.user_id = ${me} OR u.role = 'hr_admin'${P})`
        : ` WHERE (c.user_id = ${me}${P})`;
}

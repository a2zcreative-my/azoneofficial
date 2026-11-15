# GATE 1.312.1 — Finance: an added account shows, and the same account is not added twice

**Status:** BUILT AND TESTED. **NOT DEPLOYED.** There is no migration.

**Why:** the CEO, 15-11-2026, sent a screenshot with the message "Finance account add is saved, but it doesn't reflect".
- The AZ ONE OFFICIAL – Maybank account *was* saved.
- The Accounts drawer listed only the accounts of the company chosen at the top of Finance (A2Z), so the new account was hidden.
- Its Add button stayed, so pressing it again would have added it again.

## What changed
- **The Accounts drawer lists every company account**, whichever company is chosen.
  - Each account carries its company.
  - Another company's account says to choose that company to see its book balance.
  - The list reloads after every add or change.
  - "Added" on the invoice accounts is read from this full list, by company and last four digits.
- **Server:** POST /erp/banks refuses (409) an active account of the same company that ends in the same four digits. A different company may hold an account ending in the same digits.

## If the account was added twice before this fix
Open Finance → Manage accounts and set the extra copy **Inactive**. Nothing is deleted.

## Evidence (executed in the sandbox)
- **`tests/finance5.mjs`: 82 checks; all 17 deliberately broken versions were caught.** This includes the new check that the same account cannot be added twice.
- **Browser `finance5.py`: 64/64.** It includes a new check: with A2Z chosen, the drawer still lists AZ ONE's account.
- **Re-run and passing:**
  - cashflow (71)
  - access-policy (91)
  - design-tokens, tab-zones, tab-concept, interface-v3, business-joins, kept-lines, tailwind-retired
  - skeleton-loading, action-feedback, api-routes, csrf-guard, clickable-data
  - sql-schema-check, worker-compile-gate
- **Checks:** typecheck is clean (app and worker); lint shows 117 warnings and 0 errors.
- The full 198-guard run was not repeated for this hotfix. The full run passed on 1.312.0; the files changed here are the ones re-checked above.

## Deploy
PUSH.bat, together with 1.312.0 (0197/0198), whenever you approve.

# GATE 1.316.0 — Accounting Workspace 5.0, Phase B (partial): who posts, who closes, a journal kept as posted

**Status:** BUILT AND TESTED. **NOT DEPLOYED.**
**Migration:** one additive migration, 0203_journal_append_only (four triggers). No table, column or row is changed.

**Authority:** the CEO, 15-11-2026: "Approved as per recommendations both", then "continue the rest". This is Phase B of `claude/ACCOUNTING-WORKSPACE-5.0-BLUEPRINT.md` as recommended: AC-1, the append-only journal and the ownership check.

**Not in this gate:**
- AC-8 (bank reconciliation in Accounting) waits for the result of P0 query 4.
- Phases C, D and E are not built.
- Month close still locks nothing (Phase E).

## What changed

### AC-1: who reads, who posts, who closes (an access change the CEO approved)
This is enforced on the server and tested by direct request.

| | Read the books | Post a journal, add an account, reverse | Close / reopen a month |
|---|---|---|---|
| CEO | yes | yes, including his own entries | **yes (only the CEO)** |
| COO | **yes (new)** | yes; **never his own entry** (the CEO reverses it) | no |
| CCO | **yes (new)** | no | no |
| Admin, Super Admin | yes (as before) | **no (was yes)** | no |
| Everyone else | no | no | no |

- **New permissions:** `accounting_post` (`/erp/gl/journal`, `/erp/gl/accounts`, `/erp/gl/journal/:id/reverse`) and `books_close` (`/staff/books/close`, `/staff/books/reopen`).
  - Both appear in the permission matrix under Accounting.
  - The close and reopen routes still require `accounting_manage` first.
- **The screen** offers New account, the journal composer, Reverse, Close and Reopen only to the roles the server allows.
  - Anyone else sees "Adjustments and reversals are posted by the CEO or COO" or "The CEO closes and reopens a month".

### A posted journal entry is kept as posted (0203)
- The database now refuses an UPDATE or DELETE on `journal_entries` and `journal_lines`.
  - No route did either before (checked: no UPDATE or DELETE of a journal row anywhere in the worker).
  - A wrong manual entry is still corrected by its reversal (REVJ-). An entry booked from a source is still corrected at that source.
- `/api/v1/health/detail` probes that all four triggers are present.

### The ownership check reads the company columns
- Month-End's "Money records reviewed for their company" now counts the expense, cash and bank records that have no company (0197) and no review decision.
  - A record that names its company is no longer called unassigned.
- On a database without 0197, the review decisions alone are counted, as before.

## Evidence (executed in the sandbox)
- **`tests/accounting-b.mjs` (new, registered): 40 checks; all 10 deliberately broken versions were caught.**
  - It runs the whole worker with every migration applied, by direct request through real sessions.
  - It covers who reads, posts, reverses and closes; COO self-reversal; triggers that refuse edits and deletes; the trial balance after reversals; and the ownership count.
- **`tests/accounting5.mjs`: 16 checks; 11 mutations caught.** Adds the screen gates.
- **Updated tests:**
  - `tests/accounting-v2.mjs` (58 checks) and `tests/navigation.mjs` (34 checks) now expect the COO and CCO to read Accounting. That is the approved AC-1 change; their other expectations are unchanged.
  - `tests/cashflow.mjs` accepts a 02xx latest migration.
- **Browser (Chromium, the fixture server; executed 15-11-2026 on the 1.316.0 build):** accounting5 37/37 (adds the CEO, COO and admin checks), owner-roles 28/28, nav-1 138/138 (the COO and CCO now have Accounting in their rail), finance5 64/64, tasks5 77/77.
- **Full guard run (`node scripts/run-guards.mjs`): 202 of 202 passed.**
  - The first full run found three guards that 1.315.0 had left behind, and they are corrected here: `inventory-category` and `roster-week` only accepted a 01xx latest migration, and `go-live-p` completed a project without the client acceptance that TK-15 now requires (the test now proves the refusal, records the acceptance, then completes).
- Typecheck is clean for app and worker; lint shows 117 warnings and 0 errors (the limit is 125).

## Deploy notes
- PUSH.bat applies 0203 together with 1.315.0's 0199–0202.
- **After deploying:**
  - The COO and CCO see the Accounting tab.
  - The Admin and Super Admin see the books but can no longer post or reverse.
  - Only the CEO sees Close month and Reopen.

## Rollback
- Re-run PUSH.bat from the 1.315.0 files. The permissions return to their earlier state.
- The 0203 triggers stay. They only refuse edits and deletes that no route makes.
- To remove them, a `DROP TRIGGER` needs the CEO's approval.
